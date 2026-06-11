import { describe, expect, test } from "bun:test";
import { parseJson3Transcript } from "../src/yt";

describe("parseJson3Transcript", () => {
  test("joins segments and events with normalized whitespace", () => {
    const data = {
      events: [
        { segs: [{ utf8: "hello" }, { utf8: " world" }] },
        { tStartMs: 1000 },
        { segs: [{ utf8: "\nnext  line" }] },
      ],
    };
    expect(parseJson3Transcript(data)).toBe("hello world next line");
  });

  test("returns empty string for malformed payloads", () => {
    expect(parseJson3Transcript(null)).toBe("");
    expect(parseJson3Transcript({})).toBe("");
    expect(parseJson3Transcript({ events: "x" })).toBe("");
  });
});
