# Web Analyze

Chromium MV3 extension (Chrome / Arc) that analyzes the current or a chosen
browser tab with locally installed LLM CLIs (`claude`, `codex`), via a local
Bun + Hono companion server. No API keys — uses your existing subscriptions.

```
popup (settings + markdown chat) ──SSE──▶ 127.0.0.1:8787 ──▶ claude -p / codex exec
        │
        └─ chrome.scripting ──▶ tab content (article/main/body text + selection)
```

## Prerequisites

- [Bun](https://bun.sh), `claude` CLI, `codex` CLI on PATH and logged in.

## Setup

```bash
bun install
bun run build:ext        # -> extension/dist
bun run server           # companion server on 127.0.0.1:8787 (keep running)
```

Load the extension:

1. Open `chrome://extensions` (Arc: `arc://extensions`).
2. Enable **Developer mode** → **Load unpacked** → pick `extension/dist/`.

## Usage

Open any tab, click the extension icon, pick provider / model / speed /
target tab, and chat. Page text + your text selection are captured on every
send. `speed` maps to `model_reasoning_effort` for codex; the claude CLI has
no equivalent and ignores it.

## Development

```bash
bun test server                      # prompt builder + JSONL parser tests
bun run --cwd extension watch        # rebuild popup on change
```

Spec lives in `docs/specs/web-analyze-prototype/`.
