export const SERVER = "http://127.0.0.1:8787";
const HOST_NAME = "com.miyago9267.asktab";

export type Transport = "native" | "http" | "none";

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
  images?: string[];
}

export interface ModelInfo {
  id: string;
  label: string;
  speeds: string[];
}

export type ProviderCatalog = Record<
  string,
  { label: string; models: ModelInfo[]; speedNote: string }
>;

export interface UsageStats {
  input: number;
  output: number;
  cachedInput: number;
  costUsd?: number;
  durationMs?: number;
}

// --- native messaging transport (primary) ---

let nativePort: chrome.runtime.Port | null = null;
let nextId = 1;
const handlers = new Map<number, (msg: any) => void>();

function connectNative(): Promise<chrome.runtime.Port | null> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch {
      return resolve(null);
    }
    let settled = false;
    const settle = (v: chrome.runtime.Port | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    port.onMessage.addListener((msg: any) => {
      handlers.get(msg?.id)?.(msg);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // consume "host not found" etc.
      nativePort = null;
      for (const h of handlers.values()) {
        h({ type: "error", message: "native host disconnected" });
        h({ type: "done" });
      }
      handlers.clear();
      settle(null);
    });
    const id = nextId++;
    handlers.set(id, () => {
      handlers.delete(id);
      settle(port);
    });
    port.postMessage({ id, type: "health" });
    setTimeout(() => settle(null), 2000);
  });
}

async function getNative(): Promise<chrome.runtime.Port | null> {
  if (nativePort) return nativePort;
  nativePort = await connectNative();
  return nativePort;
}

/** Sends one request and feeds tagged responses to onEvent until done. */
function nativeStream(
  port: chrome.runtime.Port,
  req: object,
  onEvent: (msg: any) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const id = nextId++;
    handlers.set(id, (msg) => {
      if (msg.type === "done") {
        handlers.delete(id);
        resolve();
      } else {
        onEvent(msg);
      }
    });
    port.postMessage({ ...req, id });
  });
}

// --- public API: native first, HTTP dev server as fallback ---

export async function detectTransport(): Promise<Transport> {
  if (await getNative()) return "native";
  try {
    const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return "http";
  } catch {
    // fall through
  }
  return "none";
}

export async function fetchProviders(): Promise<ProviderCatalog> {
  const port = await getNative();
  if (port) {
    let catalog: ProviderCatalog | null = null;
    await nativeStream(port, { type: "providers" }, (msg) => {
      if (msg.type === "providers") catalog = msg.catalog;
    });
    if (catalog) return catalog;
    throw new Error("native host returned no catalog");
  }
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
  onUsage: (usage: UsageStats) => void,
): Promise<void> {
  const port = await getNative();
  if (port) {
    await nativeStream(port, { type: "chat", payload: req }, (msg) => {
      if (msg.type === "delta" && msg.text) onDelta(msg.text);
      else if (msg.type === "usage" && msg.usage) onUsage(msg.usage);
      else if (msg.type === "error") onError(msg.message ?? "unknown error");
    });
    return;
  }

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
      let ev: { type: string; text?: string; message?: string; usage?: UsageStats };
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "delta" && ev.text) onDelta(ev.text);
      else if (ev.type === "usage" && ev.usage) onUsage(ev.usage);
      else if (ev.type === "error") onError(ev.message ?? "unknown error");
      else if (ev.type === "done") return;
    }
  }
}
