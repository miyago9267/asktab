/**
 * Chrome native messaging framing: each message is a 4-byte little-endian
 * byte length followed by UTF-8 JSON. Applies in both directions.
 */

export function encodeNativeMessage(obj: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  const buf = new Uint8Array(4 + json.byteLength);
  new DataView(buf.buffer).setUint32(0, json.byteLength, true);
  buf.set(json, 4);
  return buf;
}

export class NativeMessageReader {
  private buf = new Uint8Array(0);

  feed(chunk: Uint8Array): unknown[] {
    const merged = new Uint8Array(this.buf.byteLength + chunk.byteLength);
    merged.set(this.buf);
    merged.set(chunk, this.buf.byteLength);
    this.buf = merged;

    const messages: unknown[] = [];
    for (;;) {
      if (this.buf.byteLength < 4) break;
      const len = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(0, true);
      if (this.buf.byteLength < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.slice(4 + len);
      try {
        messages.push(JSON.parse(new TextDecoder().decode(body)));
      } catch {
        // skip malformed frame
      }
    }
    return messages;
  }
}
