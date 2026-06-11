import type { ProviderEvent, Speed } from "../types";

/**
 * Parses `claude -p --output-format stream-json --include-partial-messages`
 * JSONL output. Prefers incremental text_delta events; falls back to the
 * final `result` event when no deltas were emitted (older CLI versions).
 */
export class ClaudeStreamParser {
  private sawDelta = false;

  feed(line: string): ProviderEvent[] {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }

    if (obj?.type === "stream_event") {
      const delta = obj.event?.delta;
      if (obj.event?.type === "content_block_delta" && delta?.type === "text_delta" && delta.text) {
        this.sawDelta = true;
        return [{ type: "delta", text: delta.text }];
      }
      return [];
    }

    if (obj?.type === "result") {
      if (obj.subtype && obj.subtype !== "success") {
        return [{ type: "error", message: String(obj.result ?? obj.subtype) }];
      }
      const events: ProviderEvent[] = [];
      if (!this.sawDelta && typeof obj.result === "string") {
        events.push({ type: "delta", text: obj.result });
      }
      const u = obj.usage;
      if (u) {
        const cached = u.cache_read_input_tokens ?? 0;
        events.push({
          type: "usage",
          usage: {
            input: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
            output: u.output_tokens ?? 0,
            cachedInput: cached,
            costUsd: obj.total_cost_usd,
            durationMs: obj.duration_ms,
          },
        });
      }
      return events;
    }

    return [];
  }
}

export function claudeArgs(model: string, _speed: Speed, images: string[] = []): string[] {
  // speed has no claude CLI equivalent; accepted and ignored (see SPEC ADR notes)
  const args = [
    "claude",
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  // claude -p has no image flag; it views screenshots through the Read tool
  if (images.length) args.push("--allowedTools", "Read");
  return args;
}
