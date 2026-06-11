# Web Analyze — Browser Tab Analysis via Local LLM CLIs

## What

A Chrome/Arc (Chromium MV3) extension that captures content from the current
or a chosen browser tab and sends it to locally installed LLM CLIs
(`claude`, `codex`) for analysis, summarization, or free-form chat.

## Why

- Use existing local subscriptions (Claude Max, ChatGPT/Codex) instead of API keys.
- Keep page content on the machine; nothing goes to a third-party relay.

## Architecture (ADR-001)

Chrome extensions cannot spawn local processes. Two candidates:

1. **Native Messaging host** — no extra port, but per-browser manifest
   installation (Arc/Chrome paths differ), fixed-frame stdio protocol,
   harder to debug.
2. **Local companion server (chosen)** — Bun + Hono on `127.0.0.1:8787`,
   wraps the CLIs as child processes, streams output via SSE.
   Simple to debug (curl-able), browser-agnostic, matches the existing
   Bun/Hono stack.

Decision: companion server. Native messaging can be revisited if the
"must start a server first" friction becomes a problem.

```
┌─────────────── browser ───────────────┐      ┌────────── localhost ──────────┐
│ popup (settings + chat, markdown out) │ SSE  │ Bun+Hono server :8787         │
│ chrome.scripting → page extraction    │─────▶│  ├─ claude -p  (stream-json)  │
└───────────────────────────────────────┘      │  └─ codex exec (--json, RO)   │
                                               └───────────────────────────────┘
```

## Components

### Server (`server/`)

- `GET /health` — liveness probe for the popup.
- `GET /providers` — provider/model/speed catalog (single source of truth).
- `POST /chat` — body `{provider, model, speed, messages[], page?}`;
  responds with SSE events `{type: delta|done|error}`.
- Stateless: conversation history is flattened into one prompt per request.
- Provider adapters:
  - **claude**: `claude -p --output-format stream-json --verbose
    --include-partial-messages --model <m>`, prompt via stdin.
    Parses `text_delta` events; falls back to `result` if no deltas seen.
    `speed` is ignored (no effort flag in claude CLI).
  - **codex**: `codex exec --json --ephemeral --skip-git-repo-check
    --sandbox read-only -m <m> -c model_reasoning_effort=<speed>`,
    prompt via stdin. Parses `agent_message_delta` / `agent_message`
    JSONL events (both old `msg.*` and new `item.*` shapes).

### Extension (`extension/`)

- MV3, popup-only (no background worker needed for the prototype).
- Settings row: provider select, model (datalist, free-text allowed),
  speed select, tab select (active tab default + all open tabs).
- Page extraction via `chrome.scripting.executeScript`:
  `article || main || body` innerText (capped 60k chars) + current
  selection + url/title. Re-extracted on every send.
  Non-scriptable pages (chrome://, web store) degrade to no-context chat.
- Output: chat transcript, markdown rendered with `marked`,
  sanitized with `DOMPurify`, code blocks highlighted with `highlight.js`.
- Settings persisted in `chrome.storage.local`.

## Visual & Video Capture (ADR-002, batch 3)

innerText alone makes videos and layout invisible to the model. Two opt-in
channels, both user-controlled (hard requirement: never auto-capture):

- **Screenshot** — popup checkbox (persisted, default off).
  `chrome.tabs.captureVisibleTab` (JPEG q80) → data URL → server decodes to
  a temp file (deleted after the run) → codex `-i <file>`; claude has no
  image flag, so the file path is appended to the prompt with
  `--allowedTools Read` (verified working). Limitation: only the active tab
  of the focused window can be captured; other tabs degrade with a notice.
- **Video transcript** — when the extractor detects `<video>` on the target
  tab, the popup shows a confirm bar; nothing is fetched until checked.
  YouTube: caption track from `ytInitialPlayerResponse` (MAIN world; the
  isolated world cannot see page JS), timedtext `fmt=json3`, zh > en > first
  track, appended to page content as `<video-transcript>`. Stale SPA state
  (videoId vs URL mismatch) is rejected. Non-YouTube videos: no transcript
  support, the bar suggests the screenshot channel instead.

Rejected: drawing `<video>` frames to canvas (cross-origin taint);
`chrome.debugger` full-page capture (debugger banner) deferred.

## Security

- Server binds 127.0.0.1 only.
- codex runs sandboxed read-only + ephemeral; claude runs plain `-p`.
- All model output sanitized through DOMPurify before insertion.

## Out of Scope (prototype)

- Session resume / server-side history, screenshots, side panel UI,
  auto-start of the server, syntax-aware extraction (Readability),
  claude speed mapping, multi-tab batch analysis.

## Test Strategy

TDD applied to pure logic only (prompt builder, JSONL/SSE event parsers)
via `bun test`. UI and process-spawn glue verified manually — prototype
trade-off, recorded here per TDD rule #3.
