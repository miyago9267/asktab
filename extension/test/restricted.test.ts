import { describe, expect, test } from "bun:test";
import { isScriptable } from "../src/restricted";

describe("isScriptable", () => {
  test("allows ordinary http(s) pages", () => {
    expect(isScriptable("https://example.com/a")).toBe(true);
    expect(isScriptable("http://localhost:3000/")).toBe(true);
  });

  test("rejects browser-internal schemes", () => {
    expect(isScriptable("chrome://extensions")).toBe(false);
    expect(isScriptable("arc://settings")).toBe(false);
    expect(isScriptable("about:blank")).toBe(false);
    expect(isScriptable("chrome-extension://abc/panel.html")).toBe(false);
    expect(isScriptable("file:///tmp/x.html")).toBe(false);
  });

  test("rejects the web store", () => {
    expect(isScriptable("https://chromewebstore.google.com/detail/x")).toBe(false);
    expect(isScriptable("https://chrome.google.com/webstore/detail/x")).toBe(false);
  });

  test("rejects malformed urls", () => {
    expect(isScriptable("")).toBe(false);
    expect(isScriptable("not a url")).toBe(false);
  });
});
