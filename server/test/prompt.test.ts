import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../src/prompt";

describe("buildPrompt", () => {
  test("flattens conversation with roles", () => {
    const p = buildPrompt({
      messages: [
        { role: "user", content: "summarize this" },
        { role: "assistant", content: "it is about X" },
        { role: "user", content: "more detail" },
      ],
    });
    expect(p).toContain("User: summarize this");
    expect(p).toContain("Assistant: it is about X");
    expect(p.trimEnd().endsWith("User: more detail")).toBe(true);
  });

  test("embeds page context with url and title", () => {
    const p = buildPrompt({
      messages: [{ role: "user", content: "what is this page" }],
      page: {
        url: "https://example.com/a",
        title: "Example",
        content: "hello world",
      },
    });
    expect(p).toContain('url="https://example.com/a"');
    expect(p).toContain('title="Example"');
    expect(p).toContain("hello world");
    expect(p).not.toContain("<selection>");
  });

  test("includes selection when present", () => {
    const p = buildPrompt({
      messages: [{ role: "user", content: "explain selection" }],
      page: {
        url: "https://example.com",
        title: "t",
        selection: "picked text",
        content: "body",
      },
    });
    expect(p).toContain("<selection>\npicked text\n</selection>");
  });

  test("works without page context", () => {
    const p = buildPrompt({ messages: [{ role: "user", content: "hi" }] });
    expect(p).not.toContain("<page");
    expect(p).toContain("User: hi");
  });
});
