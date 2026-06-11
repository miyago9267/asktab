import { describe, expect, test } from "bun:test";
import { GeminiStreamParser } from "../src/providers/gemini";
import { OpencodeStreamParser, parseOpencodeModels } from "../src/providers/opencode";

const j = (o: unknown) => JSON.stringify(o);

describe("GeminiStreamParser", () => {
  test("yields assistant message deltas, skips user echoes", () => {
    const p = new GeminiStreamParser();
    expect(p.feed(j({ type: "message", role: "user", content: "question" }))).toEqual([]);
    expect(
      p.feed(j({ type: "message", role: "assistant", content: "Hello", delta: true })),
    ).toEqual([{ type: "delta", text: "Hello" }]);
  });

  test("maps result stats to usage", () => {
    const p = new GeminiStreamParser();
    const ev = p.feed(
      j({
        type: "result",
        status: "success",
        stats: { input_tokens: 13553, output_tokens: 85, cached: 7, duration_ms: 11100 },
      }),
    );
    expect(ev).toEqual([
      {
        type: "usage",
        usage: { input: 13553, output: 85, cachedInput: 7, durationMs: 11100 },
      },
    ]);
  });

  test("non-success result yields error", () => {
    const p = new GeminiStreamParser();
    const ev = p.feed(j({ type: "result", status: "error", error: "quota exceeded" }));
    expect(ev[0]).toEqual({ type: "error", message: "quota exceeded" });
  });

  test("ignores init and malformed lines", () => {
    const p = new GeminiStreamParser();
    expect(p.feed(j({ type: "init", session_id: "x" }))).toEqual([]);
    expect(p.feed("junk")).toEqual([]);
  });
});

describe("OpencodeStreamParser", () => {
  test("yields text part content", () => {
    const p = new OpencodeStreamParser();
    const ev = p.feed(j({ type: "text", part: { id: "p1", type: "text", text: "OK" } }));
    expect(ev).toEqual([{ type: "delta", text: "OK" }]);
  });

  test("emits only the suffix when a part's text accumulates", () => {
    const p = new OpencodeStreamParser();
    p.feed(j({ type: "text", part: { id: "p1", text: "Hel" } }));
    const ev = p.feed(j({ type: "text", part: { id: "p1", text: "Hello" } }));
    expect(ev).toEqual([{ type: "delta", text: "lo" }]);
  });

  test("new part ids emit independently", () => {
    const p = new OpencodeStreamParser();
    p.feed(j({ type: "text", part: { id: "p1", text: "one" } }));
    const ev = p.feed(j({ type: "text", part: { id: "p2", text: "two" } }));
    expect(ev).toEqual([{ type: "delta", text: "two" }]);
  });

  test("maps step_finish tokens to usage", () => {
    const p = new OpencodeStreamParser();
    const ev = p.feed(
      j({
        type: "step_finish",
        part: {
          type: "step-finish",
          tokens: { total: 6296, input: 6280, output: 4, cache: { write: 0, read: 9 } },
        },
      }),
    );
    expect(ev).toEqual([
      { type: "usage", usage: { input: 6280, output: 4, cachedInput: 9, costUsd: undefined } },
    ]);
  });

  test("surfaces error events", () => {
    const p = new OpencodeStreamParser();
    const ev = p.feed(
      j({ type: "error", error: { name: "UnknownError", data: { message: "Model not found" } } }),
    );
    expect(ev).toEqual([{ type: "error", message: "Model not found" }]);
  });
});

describe("parseOpencodeModels", () => {
  test("parses provider/model lines", () => {
    const out = "opencode/big-pickle\naluo/gpt-5.5\ndeepseek/deepseek-chat\n\n";
    expect(parseOpencodeModels(out)).toEqual([
      { id: "opencode/big-pickle", label: "opencode/big-pickle", speeds: [] },
      { id: "aluo/gpt-5.5", label: "aluo/gpt-5.5", speeds: [] },
      { id: "deepseek/deepseek-chat", label: "deepseek/deepseek-chat", speeds: [] },
    ]);
  });

  test("ignores noise lines", () => {
    expect(parseOpencodeModels("WARN something\nfoo/bar\n")).toEqual([
      { id: "foo/bar", label: "foo/bar", speeds: [] },
    ]);
  });
});
