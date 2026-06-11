# AskTab — Browser Tab Analysis via Local LLM CLIs

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

## Codex Streaming (ADR-003, batch 4)

`codex exec` cannot stream: `--json`, plain stdout, and feature flags all
deliver the message only at turn end (verified on 0.134). True deltas exist
only in the app-server protocol (the desktop app's JSON-RPC-over-stdio API,
marked experimental).

Decision: codex chats run through a single long-lived `codex app-server`
child (v2 protocol): `initialize` → ephemeral read-only `thread/start` per
request → `turn/start` (effort = speed; images as `localImage` inputs) →
`item/agentMessage/delta` notifications stream tokens;
`thread/tokenUsage/updated` supplies usage, `turn/completed` ends the turn.
A 5-minute idle watchdog guards hung turns.

Risk: experimental protocol may drift across codex versions. Mitigation:
if the app-server path fails before yielding any output, the request
falls back to the exec pipeline (whole message at the end). claude already
streams via `--include-partial-messages`; nothing changed there.

## Native Messaging Transport (ADR-004, batch 5)

Revisits ADR-001: requiring a manually started server is unacceptable for
an extension ("nothing outside the browser"). Native messaging makes the
browser launch the host process on `connectNative` and reap it when the
port closes — no daemon, no port, no manual step.

- **Host** (`server/src/host.ts`): same provider/catalog modules as the
  HTTP server, wrapped in Chrome's stdio framing (4-byte LE length + JSON
  both ways; host→browser messages capped at 1 MB — deltas are small).
  Requests `{id, type: chat|providers|health}`; responses tagged with the
  same id. stdin EOF (port closed) exits the host.
- **Extension**: popup talks native-first; if the host is not installed,
  it falls back to the HTTP server (which stays in-repo as a curl-able
  dev tool). Requires the `nativeMessaging` permission.
- **Stable extension ID**: unpacked IDs derive from the install path, so
  each user generates a local RSA key (`extension/.key.pem`, gitignored);
  the build injects its public key into `dist/manifest.json` and the
  install script derives the matching ID for the host manifest.
- **Install** (`bun run install-host`): generates the key if missing,
  writes an absolute-path wrapper script (browsers launch hosts with a
  bare env — no PATH), and installs `com.miyago9267.asktab.json` host
  manifests into Chrome / Arc / Brave / Edge / Chromium dirs that exist.

Trade-off: each popup open spawns a fresh host (and its codex app-server
child), adding ~1s handshake before the first codex token. Acceptable;
a background service-worker keepalive can amortize it later.

## Multi-Provider Support (ADR-005, batch 6)

Add gemini and opencode; openclaw rejected (a containerized assistant
gateway, not a one-shot exec CLI — wrong shape for this pipeline).

- **gemini** (`gemini -p "" -o stream-json -m <model>`, prompt via stdin):
  `{type:"message", role:"assistant", delta:true, content}` chunks;
  `{type:"result", stats}` carries tokens/duration (usage) and non-success
  status (error). No effort flag → speed ignored. No catalog command →
  curated model list (auto-gemini-3, gemini-3-flash-preview) + free text.
- **opencode** (`opencode run --format json -m <model> <prompt-as-arg>`):
  `{type:"text", part:{id, text}}` events carry accumulated part text —
  parser tracks emitted length per part id and yields suffixes, which also
  handles disjoint parts. `step_finish` carries tokens + cost (usage);
  `error` events carry error.data.message. Models discovered live via
  `opencode models` (10 min cache). `--variant` (reasoning effort) varies
  per model and errors on mismatch → speed not mapped in v1.
- **Provider detection**: the catalog only lists providers whose CLI
  resolves on PATH (Bun.which), so the popup's provider menu mirrors the
  machine. Validation in server/host derives from the same catalog.
- **Images**: codex (`localImage`) and claude (Read tool) are first-class;
  gemini/opencode get the file path in the prompt as best-effort — their
  agents have read tools but headless tool approval is not guaranteed.
- The extension needs no changes: provider/model/speed UI is already
  catalog-driven.

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

## Quarantine-Safe Transport (ADR-006, batch 7)

Symptom: Gatekeeper "Apple cannot verify…" dialogs on every popup open /
opencode chat. Root cause: browsers set LSFileQuarantineEnabled, and the
quarantine process flag inherits down the native-messaging process tree;
opencode (bun-compiled) extracts a randomly-named unsigned dylib to TMPDIR
on every run and dlopens it — quarantined + unsigned = Gatekeeper dialog.
Random filenames defeat pre-warming or post-hoc xattr cleanup (race with
dlopen). claude/codex/gemini do not extract dylibs.

Fix: spawn CLIs with launchd as the ancestor instead of the browser.
install-host registers a LaunchAgent (com.miyago9267.asktab.server,
RunAtLoad + KeepAlive) running the existing HTTP server; the popup now
prefers HTTP and uses native messaging only as fallback (with a status
warning about Gatekeeper). Verified: dylibs created under the launchd
server carry no com.apple.quarantine xattr.

Bonus: the codex app-server child persists across popups, removing the
per-popup ~1s handshake of the pure native path.
