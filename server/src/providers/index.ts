import type { ChatRequest, ProviderEvent, ProviderId } from "../types";
import { ClaudeStreamParser, claudeArgs } from "./claude";
import { CodexStreamParser, codexArgs } from "./codex";
import { buildPrompt } from "../prompt";

/** Single source of truth for the popup's settings dropdowns. */
export const CATALOG = {
  claude: {
    label: "Claude (claude CLI)",
    models: ["sonnet", "opus", "haiku"],
    speedNote: "speed is ignored by the claude CLI",
  },
  codex: {
    label: "Codex (codex CLI)",
    models: ["gpt-5.5", "gpt-5.5-codex"],
    speedNote: "speed maps to model_reasoning_effort",
  },
} as const;

interface LineParser {
  feed(line: string): ProviderEvent[];
}

function makeParser(provider: ProviderId): LineParser {
  return provider === "claude" ? new ClaudeStreamParser() : new CodexStreamParser();
}

function makeArgs(req: ChatRequest): string[] {
  return req.provider === "claude"
    ? claudeArgs(req.model, req.speed)
    : codexArgs(req.model, req.speed);
}

/**
 * Spawns the provider CLI, writes the flattened prompt to stdin, and
 * yields parsed events from its JSONL stdout.
 */
export async function* runChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
  const prompt = buildPrompt(req);
  const parser = makeParser(req.provider);

  const proc = Bun.spawn(makeArgs(req), {
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
