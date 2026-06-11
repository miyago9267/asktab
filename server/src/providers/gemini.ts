import type { ProviderEvent, Speed } from "../types";

/**
 * Parses `gemini -p "" -o stream-json` JSONL: assistant message events
 * carry incremental content; the final result event carries stats.
 */
export class GeminiStreamParser {
  private sawDelta = false;

  feed(line: string): ProviderEvent[] {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }

    if (obj?.type === "message" && obj.role === "assistant" && typeof obj.content === "string") {
      // a full non-delta message after deltas would duplicate the text
      if (obj.delta !== true && this.sawDelta) return [];
      if (obj.delta === true) this.sawDelta = true;
      return obj.content ? [{ type: "delta", text: obj.content }] : [];
    }

    if (obj?.type === "result") {
      if (obj.status && obj.status !== "success") {
        return [{ type: "error", message: String(obj.error ?? obj.status) }];
      }
      const s = obj.stats;
      if (s) {
        return [
          {
            type: "usage",
            usage: {
              input: s.input_tokens ?? 0,
              output: s.output_tokens ?? 0,
              cachedInput: s.cached ?? 0,
              durationMs: s.duration_ms,
            },
          },
        ];
      }
    }

    return [];
  }
}

export function geminiArgs(model: string, _speed: Speed): string[] {
  // headless mode: -p with empty prompt, real prompt arrives via stdin;
  // speed has no gemini CLI equivalent
  return ["gemini", "-p", "", "-o", "stream-json", "-m", model];
}
