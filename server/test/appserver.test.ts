import { describe, expect, test } from "bun:test";
import { CodexNotificationMapper } from "../src/providers/appserver";

const T = "thread-1";

describe("CodexNotificationMapper", () => {
  test("maps agentMessage deltas for its thread only", () => {
    const m = new CodexNotificationMapper(T);
    expect(
      m.feed({ method: "item/agentMessage/delta", params: { threadId: T, delta: "Hi" } }),
    ).toEqual([{ type: "delta", text: "Hi" }]);
    expect(
      m.feed({ method: "item/agentMessage/delta", params: { threadId: "other", delta: "x" } }),
    ).toEqual([]);
  });

  test("captures usage and emits it on turn/completed", () => {
    const m = new CodexNotificationMapper(T);
    m.feed({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: T,
        tokenUsage: {
          last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 7 },
          total: { inputTokens: 999, cachedInputTokens: 0, outputTokens: 999 },
        },
      },
    });
    const ev = m.feed({
      method: "turn/completed",
      params: { threadId: T, turn: { status: "completed" } },
    });
    expect(ev).toEqual([
      { type: "usage", usage: { input: 100, output: 7, cachedInput: 40 } },
    ]);
    expect(m.done).toBe(true);
  });

  test("turn/completed with failed status yields error", () => {
    const m = new CodexNotificationMapper(T);
    const ev = m.feed({
      method: "turn/completed",
      params: { threadId: T, turn: { status: "failed", error: { message: "boom" } } },
    });
    expect(ev).toEqual([{ type: "error", message: "boom" }]);
    expect(m.done).toBe(true);
  });

  test("error notifications for the thread surface as errors", () => {
    const m = new CodexNotificationMapper(T);
    const ev = m.feed({
      method: "error",
      params: { threadId: T, error: { message: "rate limited" } },
    });
    expect(ev).toEqual([{ type: "error", message: "rate limited" }]);
  });

  test("ignores unrelated notifications", () => {
    const m = new CodexNotificationMapper(T);
    expect(m.feed({ method: "skills/changed", params: {} })).toEqual([]);
    expect(m.feed({ method: "item/started", params: { threadId: T } })).toEqual([]);
    expect(m.done).toBe(false);
  });
});
