import { describe, expect, test } from "bun:test";
import { encodeNativeMessage, NativeMessageReader } from "../src/framing";

describe("native messaging framing", () => {
  test("encode produces 4-byte LE length prefix + JSON", () => {
    const buf = encodeNativeMessage({ a: 1 });
    const len = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
    expect(len).toBe(buf.byteLength - 4);
    expect(JSON.parse(new TextDecoder().decode(buf.subarray(4)))).toEqual({ a: 1 });
  });

  test("round-trips through the reader", () => {
    const r = new NativeMessageReader();
    const msgs = r.feed(encodeNativeMessage({ id: 1, type: "health" }));
    expect(msgs).toEqual([{ id: 1, type: "health" }]);
  });

  test("handles split and concatenated frames", () => {
    const r = new NativeMessageReader();
    const a = encodeNativeMessage({ n: 1 });
    const b = encodeNativeMessage({ n: 2 });
    const joined = new Uint8Array([...a, ...b]);
    const first = joined.subarray(0, 3); // mid-header split
    const rest = joined.subarray(3);
    expect(r.feed(first)).toEqual([]);
    expect(r.feed(rest)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("handles multibyte UTF-8 payloads", () => {
    const r = new NativeMessageReader();
    const msg = { text: "分頁摘要 ✓" };
    expect(r.feed(encodeNativeMessage(msg))).toEqual([msg]);
  });
});
