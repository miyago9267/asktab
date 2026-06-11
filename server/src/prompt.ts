import type { ChatMessage, PageContext } from "./types";

const PREAMBLE = `You are a web page analysis assistant. The user is looking at a browser tab whose extracted content may be provided below. Answer the user's request about it: analyze, summarize, explain, or anything else they ask. Reply in the same language the user writes in. Use markdown.`;

/**
 * Flattens page context + conversation history into a single prompt,
 * since both CLIs are invoked statelessly (one process per request).
 */
export function buildPrompt(req: {
  messages: ChatMessage[];
  page?: PageContext;
}): string {
  const parts: string[] = [PREAMBLE];

  if (req.page) {
    const { url, title, selection, content } = req.page;
    parts.push(`<page url="${url}" title="${title.replaceAll('"', "'")}">\n${content}\n</page>`);
    if (selection?.trim()) {
      parts.push(`The user has selected this text on the page:\n<selection>\n${selection}\n</selection>`);
    }
  }

  const transcript = req.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  parts.push(`Conversation so far (respond to the last User message):\n\n${transcript}`);

  return parts.join("\n\n");
}
