import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { getCatalog } from "./catalog";
import { runChat } from "./providers";
import type { ChatRequest } from "./types";

const PROVIDERS = ["claude", "codex"];

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.get("/providers", async (c) => c.json(await getCatalog()));

app.post("/chat", async (c) => {
  const req = (await c.req.json()) as ChatRequest;
  if (!req?.provider || !req?.model || !req?.messages?.length) {
    return c.json({ error: "provider, model and messages are required" }, 400);
  }
  if (!PROVIDERS.includes(req.provider)) {
    return c.json({ error: `unknown provider: ${req.provider}` }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const ev of runChat(req)) {
        await stream.writeSSE({ data: JSON.stringify(ev) });
      }
      await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: String(err) }),
      });
    }
  });
});

export default {
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 240, // CLI responses can take minutes on high effort
  fetch: app.fetch,
};

console.log(`web-analyze server on http://127.0.0.1:${PORT}`);
