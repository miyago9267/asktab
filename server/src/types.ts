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
  /** Screenshots as data URLs (user opt-in from the popup). */
  images?: string[];
}

export interface UsageStats {
  /** Total input tokens, including cached. */
  input: number;
  output: number;
  cachedInput: number;
  costUsd?: number;
  durationMs?: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Reasoning-effort levels the model supports; empty = speed not applicable. */
  speeds: string[];
}

/** Streamed unit emitted by a provider adapter. */
export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: UsageStats }
  | { type: "error"; message: string };
