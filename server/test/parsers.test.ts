import { describe, expect, test } from "bun:test";
import { ClaudeStreamParser } from "../src/providers/claude";
import { CodexStreamParser } from "../src/providers/codex";

const j = (o: unknown) => JSON.stringify(o);

describe("ClaudeStreamParser", () => {
  test("yields text deltas from stream_event lines", () => {
    const p = new ClaudeStreamParser();
    const ev = p.feed(
      j({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        },
      }),
    );
    expect(ev).toEqual([{ type: "delta", text: "Hel" }]);
  });

  test("falls back to result when no deltas were seen", () => {
    const p = new ClaudeStreamParser();
    const ev = p.feed(j({ type: "result", subtype: "success", result: "full answer" }));
    expect(ev).toEqual([{ type: "delta", text: "full answer" }]);
  });

  test("ignores result when deltas already streamed", () => {
    const p = new ClaudeStreamParser();
    p.feed(
      j({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      }),
    );
    const ev = p.feed(j({ type: "result", subtype: "success", result: "x" }));
    expect(ev).toEqual([]);
  });

  test("surfaces error results", () => {
    const p = new ClaudeStreamParser();
    const ev = p.feed(j({ type: "result", subtype: "error_during_execution", result: "boom" }));
    expect(ev[0]?.type).toBe("error");
  });

  test("ignores malformed lines", () => {
    const p = new ClaudeStreamParser();
    expect(p.feed("not json")).toEqual([]);
  });
});

describe("CodexStreamParser", () => {
  test("yields agent_message_delta (legacy msg shape)", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(j({ id: "1", msg: { type: "agent_message_delta", delta: "Hi" } }));
    expect(ev).toEqual([{ type: "delta", text: "Hi" }]);
  });

  test("yields full agent_message when no deltas seen", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(j({ id: "1", msg: { type: "agent_message", message: "done" } }));
    expect(ev).toEqual([{ type: "delta", text: "done" }]);
  });

  test("skips agent_message after deltas (no duplication)", () => {
    const p = new CodexStreamParser();
    p.feed(j({ msg: { type: "agent_message_delta", delta: "d" } }));
    const ev = p.feed(j({ msg: { type: "agent_message", message: "d" } }));
    expect(ev).toEqual([]);
  });

  test("yields item.completed agent_message (codex 0.134 shape)", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(
      j({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "answer" } }),
    );
    expect(ev).toEqual([{ type: "delta", text: "answer" }]);
  });

  test("surfaces turn.failed as error", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(j({ type: "turn.failed", error: { message: "boom" } }));
    expect(ev).toEqual([{ type: "error", message: "boom" }]);
  });

  test("ignores reasoning and command items", () => {
    const p = new CodexStreamParser();
    expect(
      p.feed(j({ type: "item.completed", item: { id: "i", type: "reasoning", text: "thinking" } })),
    ).toEqual([]);
  });

  test("surfaces error events", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(j({ msg: { type: "error", message: "rate limited" } }));
    expect(ev).toEqual([{ type: "error", message: "rate limited" }]);
  });

  test("ignores unrelated events and bad json", () => {
    const p = new CodexStreamParser();
    expect(p.feed(j({ msg: { type: "token_count", info: {} } }))).toEqual([]);
    expect(p.feed("garbage")).toEqual([]);
  });
});
