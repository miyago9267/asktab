export const SERVER = "http://127.0.0.1:8787";

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
  provider: string;
  model: string;
  speed: string;
  messages: ChatMessage[];
  page?: PageContext;
}

export type ProviderCatalog = Record<
  string,
  { label: string; models: string[]; speedNote: string }
>;

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchProviders(): Promise<ProviderCatalog> {
  const res = await fetch(`${SERVER}/providers`);
  if (!res.ok) throw new Error(`providers: HTTP ${res.status}`);
  return res.json();
}

/**
 * POSTs a chat request and feeds parsed SSE events to the callbacks
 * until the server signals done.
 */
export async function streamChat(
  req: ChatRequest,
  onDelta: (text: string) => void,
  onError: (message: string) => void,
): Promise<void> {
  const res = await fetch(`${SERVER}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) throw new Error(`chat: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let ev: { type: string; text?: string; message?: string };
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "delta" && ev.text) onDelta(ev.text);
      else if (ev.type === "error") onError(ev.message ?? "unknown error");
      else if (ev.type === "done") return;
    }
  }
}
