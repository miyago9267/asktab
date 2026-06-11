import { describe, expect, test } from "bun:test";
import { ClaudeStreamParser, claudeArgs } from "../src/providers/claude";
import { CodexStreamParser, codexArgs } from "../src/providers/codex";

describe("image attachment args", () => {
  test("claude gains Read tool only when images are attached", () => {
    expect(claudeArgs("haiku", "medium")).not.toContain("--allowedTools");
    const withImg = claudeArgs("haiku", "medium", ["/tmp/a.png"]);
    expect(withImg).toContain("--allowedTools");
    expect(withImg).toContain("Read");
  });

  test("codex attaches each image via -i", () => {
    const args = codexArgs("gpt-5.5", "low", ["/tmp/a.png", "/tmp/b.jpg"]);
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args).toContain("/tmp/a.png");
    expect(args).toContain("/tmp/b.jpg");
    expect(args.indexOf("-")).toBe(args.length - 1);
  });
});

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

  test("emits usage from result event", () => {
    const p = new ClaudeStreamParser();
    p.feed(
      j({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      }),
    );
    const ev = p.feed(
      j({
        type: "result",
        subtype: "success",
        result: "x",
        duration_ms: 4200,
        total_cost_usd: 0.0123,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
        },
      }),
    );
    expect(ev).toEqual([
      {
        type: "usage",
        usage: { input: 130, output: 5, cachedInput: 100, costUsd: 0.0123, durationMs: 4200 },
      },
    ]);
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

  test("emits usage from turn.completed", () => {
    const p = new CodexStreamParser();
    const ev = p.feed(
      j({
        type: "turn.completed",
        usage: {
          input_tokens: 37995,
          cached_input_tokens: 5504,
          output_tokens: 34,
          reasoning_output_tokens: 26,
        },
      }),
    );
    expect(ev).toEqual([
      { type: "usage", usage: { input: 37995, output: 34, cachedInput: 5504 } },
    ]);
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
