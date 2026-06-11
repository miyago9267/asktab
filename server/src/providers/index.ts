import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ChatRequest, ProviderEvent, ProviderId } from "../types";
import { runCodexAppServer } from "./appserver";
import { ClaudeStreamParser, claudeArgs } from "./claude";
import { CodexStreamParser, codexArgs } from "./codex";
import { buildPrompt } from "../prompt";

interface LineParser {
  feed(line: string): ProviderEvent[];
}

function makeParser(provider: ProviderId): LineParser {
  return provider === "claude" ? new ClaudeStreamParser() : new CodexStreamParser();
}

function makeArgs(req: ChatRequest, imagePaths: string[]): string[] {
  return req.provider === "claude"
    ? claudeArgs(req.model, req.speed, imagePaths)
    : codexArgs(req.model, req.speed, imagePaths);
}

/** Decodes data-URL screenshots into temp files the CLIs can open. */
async function writeImageFiles(images: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [i, dataUrl] of images.entries()) {
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/s);
    if (!m) continue;
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const path = `${tmpdir()}/web-analyze-${Date.now()}-${i}.${ext}`;
    await Bun.write(path, Buffer.from(m[2], "base64"));
    paths.push(path);
  }
  return paths;
}

function imageNote(provider: ProviderId, paths: string[]): string {
  if (!paths.length) return "";
  return provider === "claude"
    ? `\n\nScreenshots of the page as currently rendered are saved at: ${paths.join(", ")}. View them with the Read tool before answering.`
    : "\n\nScreenshots of the page as currently rendered are attached.";
}

/**
 * Streams one chat. codex goes through the app-server (token-level deltas);
 * if that fails before any output, it falls back to the exec pipeline,
 * which only yields the full message at the end. claude uses -p stream-json.
 */
export async function* runChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
  const imagePaths = await writeImageFiles(req.images ?? []);
  const prompt = buildPrompt(req) + imageNote(req.provider, imagePaths);

  try {
    if (req.provider === "codex") {
      let yielded = false;
      try {
        for await (const ev of runCodexAppServer(req.model, req.speed, prompt, imagePaths)) {
          yielded = true;
          yield ev;
        }
        return;
      } catch (err) {
        if (yielded) {
          yield { type: "error", message: `codex app-server: ${String(err)}` };
          return;
        }
        console.error("codex app-server unavailable, falling back to exec:", err);
      }
    }
    yield* runCliChat(req, prompt, imagePaths);
  } finally {
    await Promise.all(imagePaths.map((p) => unlink(p).catch(() => {})));
  }
}

/** Spawn-per-request CLI pipeline (claude always; codex as fallback). */
async function* runCliChat(
  req: ChatRequest,
  prompt: string,
  imagePaths: string[],
): AsyncGenerator<ProviderEvent> {
  const parser = makeParser(req.provider);

  {
    const proc = Bun.spawn(makeArgs(req, imagePaths), {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });

    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield* parser.feed(line);
      }
    }
    if (buffer.trim()) yield* parser.feed(buffer);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      yield {
        type: "error",
        message: `${req.provider} exited with code ${exitCode}: ${stderr.slice(-2000)}`,
      };
    }
  }
}
