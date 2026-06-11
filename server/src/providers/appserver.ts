import { tmpdir } from "node:os";
import { SPAWN_ENV } from "../env";
import type { ProviderEvent, Speed } from "../types";

interface JsonRpcMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string };
}

/**
 * Maps app-server v2 notifications for one thread into ProviderEvents.
 * Usage arrives via thread/tokenUsage/updated before turn/completed,
 * so it is buffered and flushed on completion.
 */
export class CodexNotificationMapper {
  done = false;
  private usage: ProviderEvent | null = null;

  constructor(private threadId: string) {}

  feed(msg: JsonRpcMessage): ProviderEvent[] {
    const p = msg.params;
    if (!msg.method || p?.threadId !== this.threadId) return [];

    switch (msg.method) {
      case "item/agentMessage/delta":
        return typeof p.delta === "string" ? [{ type: "delta", text: p.delta }] : [];

      case "thread/tokenUsage/updated": {
        const last = p.tokenUsage?.last;
        if (last) {
          this.usage = {
            type: "usage",
            usage: {
              input: last.inputTokens ?? 0,
              output: last.outputTokens ?? 0,
              cachedInput: last.cachedInputTokens ?? 0,
            },
          };
        }
        return [];
      }

      case "turn/completed": {
        this.done = true;
        if (p.turn?.status === "failed") {
          return [{ type: "error", message: String(p.turn?.error?.message ?? "turn failed") }];
        }
        return this.usage ? [this.usage] : [];
      }

      case "error":
        return [{ type: "error", message: String(p.error?.message ?? p.message ?? "error") }];

      default:
        return [];
    }
  }
}

const IDLE_TIMEOUT_MS = 300_000;

/**
 * Long-lived `codex app-server` JSON-RPC client (newline-delimited over
 * stdio). One process serves all requests; threads are ephemeral per chat.
 */
class AppServerClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(msg: JsonRpcMessage) => void>();

  onNotification(cb: (msg: JsonRpcMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async request(method: string, params: unknown): Promise<any> {
    await this.ensure();
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private send(o: unknown) {
    (this.proc!.stdin as any).write(JSON.stringify(o) + "\n");
  }

  private async ensure(): Promise<void> {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return;

    const proc = Bun.spawn(["codex", "app-server"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: SPAWN_ENV,
    });
    this.proc = proc;
    this.readLoop(proc).catch(() => {});

    const id = this.nextId++;
    this.send({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: { clientInfo: { name: "asktab", title: "asktab", version: "0.1.0" } },
    });
    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("app-server initialize timeout"));
      }, 10_000);
    });
    this.send({ jsonrpc: "2.0", method: "initialized" });
  }

  private async readLoop(proc: ReturnType<typeof Bun.spawn>) {
    let buf = "";
    for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
      buf += new TextDecoder().decode(chunk);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message ?? "app-server error"));
          else resolve(msg.result);
        } else if (msg.method) {
          for (const cb of this.listeners) cb(msg);
        }
      }
    }
    // process died: fail anything still in flight so callers can fall back
    const err = new Error("codex app-server exited");
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    if (this.proc === proc) this.proc = null;
  }
}

export const appServer = new AppServerClient();

/** Streams one ephemeral codex chat through the app-server. */
export async function* runCodexAppServer(
  model: string,
  speed: Speed,
  prompt: string,
  imagePaths: string[],
): AsyncGenerator<ProviderEvent> {
  const started = await appServer.request("thread/start", {
    model,
    sandbox: "read-only",
    approvalPolicy: "never",
    ephemeral: true,
    cwd: tmpdir(),
  });
  const threadId = started?.threadId ?? started?.thread?.id;
  if (!threadId) throw new Error("thread/start returned no threadId");

  const mapper = new CodexNotificationMapper(threadId);
  const queue: JsonRpcMessage[] = [];
  let wake = () => {};
  const unsubscribe = appServer.onNotification((msg) => {
    queue.push(msg);
    wake();
  });

  try {
    await appServer.request("turn/start", {
      threadId,
      effort: speed,
      input: [
        { type: "text", text: prompt },
        ...imagePaths.map((path) => ({ type: "localImage", path })),
      ],
    });

    while (!mapper.done) {
      if (queue.length === 0) {
        const idle = await Promise.race([
          new Promise<false>((r) => {
            wake = () => r(false);
          }),
          new Promise<true>((r) => setTimeout(() => r(true), IDLE_TIMEOUT_MS)),
        ]);
        if (idle) {
          yield { type: "error", message: "codex app-server idle timeout" };
          return;
        }
      }
      while (queue.length) yield* mapper.feed(queue.shift()!);
    }
  } finally {
    unsubscribe();
  }
}
