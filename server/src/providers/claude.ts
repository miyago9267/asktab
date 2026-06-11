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
      if (!this.sawDelta && typeof obj.result === "string") {
        return [{ type: "delta", text: obj.result }];
      }
    }

    return [];
  }
}

export function claudeArgs(model: string, _speed: Speed): string[] {
  // speed has no claude CLI equivalent; accepted and ignored (see SPEC ADR notes)
  return [
    "claude",
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
}
