import type { ModelInfo, ProviderEvent, Speed } from "../types";

/**
 * Parses `opencode run --format json` JSONL. text events carry the
 * accumulated text of a message part, so deltas are computed as the
 * suffix beyond what was already emitted for that part id.
 */
export class OpencodeStreamParser {
  private emitted = new Map<string, number>();

  feed(line: string): ProviderEvent[] {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }

    if (obj?.type === "text" && typeof obj.part?.text === "string") {
      const id = String(obj.part.id ?? "default");
      const text = obj.part.text;
      const seen = this.emitted.get(id) ?? 0;
      const delta = text.length > seen ? text.slice(seen) : text.length < seen ? text : "";
      this.emitted.set(id, Math.max(seen, text.length));
      return delta ? [{ type: "delta", text: delta }] : [];
    }

    if (obj?.type === "step_finish" && obj.part?.tokens) {
      const t = obj.part.tokens;
      return [
        {
          type: "usage",
          usage: {
            input: t.input ?? 0,
            output: t.output ?? 0,
            cachedInput: t.cache?.read ?? 0,
            costUsd: obj.part.cost || undefined,
          },
        },
      ];
    }

    if (obj?.type === "error") {
      return [
        {
          type: "error",
          message: String(obj.error?.data?.message ?? obj.error?.name ?? "opencode error"),
        },
      ];
    }

    return [];
  }
}

export function opencodeArgs(model: string, _speed: Speed, prompt: string): string[] {
  // opencode takes the message as a positional arg; --variant (effort)
  // varies per model and errors on mismatch, so speed is not mapped
  return ["opencode", "run", "--format", "json", "-m", model, prompt];
}

/** Parses `opencode models` output: one provider/model per line. */
export function parseOpencodeModels(out: string): ModelInfo[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/[\w.@-]+$/.test(l))
    .map((id) => ({ id, label: id, speeds: [] }));
}
