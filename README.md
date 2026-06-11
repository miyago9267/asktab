# AskTab

Chat with the browser tab you're looking at, powered by the LLM CLIs you
already have (`claude`, `codex`, `gemini`, `opencode`) — no API keys, no extra accounts.

## Why

I wanted "ask an LLM about this page" in my browser, but:

- I refuse to install ChatGPT Atlas — a cheap Chromium knockoff with zero
  performance tuning, where the AI features are the only part that works.
  I'm not replacing my daily browser with a wrapper around a chatbox.
- The Claude for Chrome extension doesn't support Arc.

Since I already pay for Claude Max and ChatGPT, and both ship a local CLI,
this extension just bridges the browser to those CLIs and works in any
Chromium browser — Arc included. My browser stays my browser.

## How it works

```
popup (settings + markdown chat) ──native messaging──▶ host (Bun, on demand)
        │                                                ├─ claude -p (stream-json)
        └─ chrome.scripting ──▶ tab content              └─ codex app-server (deltas)
           (article/main/body text + selection)
```

- **Extension** (MV3, TypeScript): popup with provider / model / speed /
  target-tab pickers and a chat window (marked + DOMPurify + highlight.js).
  Page text and your selection are captured on every send; screenshots and
  YouTube transcripts are opt-in.
- **Native host** (Bun): launched by the browser on demand, gone when the
  popup closes — nothing to keep running. Wraps `claude -p` and a codex
  app-server session, both streaming token deltas. Codex models are
  discovered live; speed maps to `model_reasoning_effort`.
- **Usage stats**: per-reply token/cost line, session total, and daily
  totals persisted in `chrome.storage.local`.

## Setup

```bash
bun install
bun run install-host     # registers the native host + a stable extension ID
bun run build:ext        # -> extension/dist
```

Then `chrome://extensions` (Arc: `arc://extensions`) → Developer mode →
Load unpacked → `extension/dist/`. That's it — no server to start.

Requires [Bun](https://bun.sh) plus at least one of the `claude` / `codex` /
`gemini` / `opencode` CLIs on PATH and logged in — the provider menu shows
whichever are installed. Re-run `install-host` if you move the repo.

## Development

```bash
bun test server                      # prompt builder + parser tests
bun run --cwd extension watch        # rebuild popup on change
bun run server                       # optional HTTP dev server (curl-able);
                                     # the popup falls back to it automatically
```

Spec lives in `docs/specs/asktab-prototype/`.
