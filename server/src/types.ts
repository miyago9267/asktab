export type ProviderId = "claude" | "codex";
export type Speed = "low" | "medium" | "high";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PageContext {
  url: string;
  title: string;
  selection?: string;
  content: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  speed: Speed;
  messages: ChatMessage[];
  page?: PageContext;
}

/** Streamed unit emitted by a provider adapter. */
export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "error"; message: string };
