import type { ProviderEvent, Speed } from "../types";

/**
 * Parses `codex exec --json` JSONL output. Handles both the legacy
 * `{msg: {type, ...}}` event shape and the newer `{type: "item.*", item}`
 * thread-event shape, deduplicating the final message when deltas streamed.
 */
export class CodexStreamParser {
  private sawDelta = false;

  feed(line: string): ProviderEvent[] {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }

    const msg = obj?.msg;
    if (msg?.type === "agent_message_delta" && typeof msg.delta === "string") {
      this.sawDelta = true;
      return [{ type: "delta", text: msg.delta }];
    }
    if (msg?.type === "agent_message" && typeof msg.message === "string") {
      return this.sawDelta ? [] : [{ type: "delta", text: msg.message }];
    }
    if (msg?.type === "error") {
      return [{ type: "error", message: String(msg.message ?? "codex error") }];
    }

    const item = obj?.item;
    if (
      obj?.type === "item.completed" &&
      (item?.type === "agent_message" || item?.item_type === "agent_message")
    ) {
      const text = item.text;
      if (typeof text === "string") {
        return this.sawDelta ? [] : [{ type: "delta", text }];
      }
    }
    if (obj?.type === "turn.failed") {
      return [{ type: "error", message: String(obj.error?.message ?? "codex turn failed") }];
    }
    if (obj?.type === "error" && typeof obj.message === "string") {
      return [{ type: "error", message: obj.message }];
    }

    return [];
  }
}

export function codexArgs(model: string, speed: Speed): string[] {
  return [
    "codex",
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${speed}"`,
    "-", // read prompt from stdin
  ];
}
