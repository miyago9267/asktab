# Web Analyze

Chat with the browser tab you're looking at, powered by the LLM CLIs you
already have (`claude`, `codex`) — no API keys, no extra accounts.

## Why

I wanted "ask an LLM about this page" in my browser, but:

- I don't want to install ChatGPT Atlas just for that.
- The Claude for Chrome extension doesn't support Arc.

Since I already pay for Claude Max and ChatGPT, and both ship a local CLI,
this extension just bridges the browser to those CLIs and works in any
Chromium browser — Arc included.

## How it works

```
popup (settings + markdown chat) ──SSE──▶ 127.0.0.1:8787 ──▶ claude -p / codex exec
        │
        └─ chrome.scripting ──▶ tab content (article/main/body text + selection)
```

- **Extension** (MV3, TypeScript): popup with provider / model / speed /
  target-tab pickers and a chat window (marked + DOMPurify + highlight.js).
  Page text and your selection are captured on every send.
- **Companion server** (Bun + Hono, localhost only): wraps `claude -p`
  (stream-json, token streaming) and `codex exec --json` (read-only sandbox,
  ephemeral), streams back over SSE. Codex models are discovered live via
  `codex debug models`; speed maps to `model_reasoning_effort`.
- **Usage stats**: per-reply token/cost line, session total, and daily
  totals persisted in `chrome.storage.local`.

## Setup

```bash
bun install
bun run build:ext        # -> extension/dist
bun run server           # keep running on 127.0.0.1:8787
```

Then `chrome://extensions` (Arc: `arc://extensions`) → Developer mode →
Load unpacked → `extension/dist/`.

Requires [Bun](https://bun.sh) plus the `claude` and `codex` CLIs on PATH
and logged in.

## Development

```bash
bun test server                      # prompt builder + parser tests
bun run --cwd extension watch        # rebuild popup on change
```

Spec lives in `docs/specs/web-analyze-prototype/`.
