# Tasks — asktab prototype

## Batch 1: prototype

- [x] Spec + project scaffold (bun workspaces, tsconfig)
- [x] Server: types + prompt builder (with tests)
- [x] Server: claude adapter (stream-json parser, with tests)
- [x] Server: codex adapter (JSONL parser, with tests)
- [x] Server: Hono app (/health, /providers, /chat SSE)
- [x] Extension: manifest + popup HTML/CSS
- [x] Extension: page extractor + tab picker
- [x] Extension: SSE client + markdown chat UI
- [x] Extension: build script (bun build + static copy)
- [x] HTTP-level E2E: both providers verified via curl (claude streams
      token deltas; codex 0.134 returns whole message — no delta events)
- [ ] Manual E2E in Arc: load unpacked, analyze a real page (Miyago)

## Batch 2: bugfixes + usage

- [x] Fix: IME composition Enter (RIME) no longer triggers send
      (isComposing / keyCode 229 guard)
- [x] Fix: real model lists — codex via `codex debug models` (10 min cache,
      static fallback), claude via verified aliases (fable/opus/sonnet/haiku)
- [x] Speed options now per-model from catalog (codex: low/medium/high/xhigh;
      claude: disabled with note)
- [x] Usage stats: parsers emit usage events (claude result / codex
      turn.completed); per-reply line + session Σ in status bar;
      daily totals persisted to chrome.storage.local ("usageTotals")
- [ ] Usage history view (data already accumulating)

## Batch 3: visual & video capture (opt-in)

- [x] Server: images[] in ChatRequest, data URL -> temp file -> codex -i /
      claude Read-tool path note (+ cleanup, arg builder tests)
- [x] Extension: screenshot checkbox (persisted, active-tab only,
      captureVisibleTab JPEG q80)
- [x] Extension: video detection + confirm bar (never auto-extracts)
- [x] Extension: YouTube transcript via MAIN-world ytInitialPlayerResponse
      + timedtext json3 (parser tested; stale-SPA guard)
- [x] HTTP-level E2E: both providers answered about an attached image;
      temp files cleaned
- [ ] Manual E2E in Arc: screenshot + YT transcript on real pages (Miyago)

## Batch 4: codex streaming

- [x] Investigate: exec --json / plain / feature flags — no deltas anywhere
- [x] Spike: app-server v2 (thread/start + turn/start) streams
      item/agentMessage/delta token-by-token
- [x] AppServerClient (singleton JSON-RPC over stdio, restart on death,
      pending-request rejection) + notification mapper (tested)
- [x] runChat: codex via app-server, exec fallback when no output yielded;
      images as localImage inputs; idle watchdog 300s
- [x] HTTP E2E: token-level deltas + usage + process reuse verified
- [ ] Future: model/list RPC could replace `codex debug models`

## Batch 5: native messaging (no manual server)

- [x] stdio framing codec (4-byte LE + JSON, split/concat safe, tested)
- [x] Host entry (health/providers/chat over framed stdio, exits on EOF)
- [x] install-host script: RSA key -> stable extension ID, abs-path
      wrapper, host manifests for Chrome/Arc/Brave/Edge/Chromium
- [x] build:ext injects key into dist/manifest.json; nativeMessaging perm
- [x] popup: native-first transport, HTTP dev server as automatic fallback
- [x] E2E: framed health/providers/chat verified against the real host
- [ ] Arc live test: reload extension, confirm "no server" flow (Miyago)

## Batch 6: multi-provider (gemini + opencode)

- [x] Recon: gemini stream-json shape, opencode json events + `opencode
      models`; openclaw rejected (assistant gateway, wrong shape)
- [x] Gemini adapter: assistant-delta parser + result stats usage (tested)
- [x] Opencode adapter: part-suffix delta parser, step_finish usage,
      `opencode models` catalog parsing (tested)
- [x] Catalog: provider defs + PATH detection — menu mirrors installed CLIs
- [x] Fix latent batch-5 bug: Bun snapshots env at startup, so bare browser
      PATH broke every spawn; env.ts AUGMENTED_PATH/SPAWN_ENV now applied
      to all Bun.which/Bun.spawn call sites
- [x] E2E under bare PATH via host: 4 providers detected, gemini + opencode
      streamed with usage
- [ ] Arc live test with gemini/opencode (Miyago)

## Batch 7: Gatekeeper fix (quarantine-safe transport)

- [x] Root cause: browser quarantine flag inherits down the process tree;
      opencode extracts random-named unsigned dylibs per run -> dialog spam
- [x] install-host registers launchd agent for the HTTP server
- [x] popup transport priority flipped: http (launchd) first, native
      messaging fallback with Gatekeeper warning
- [x] Verified: dylib via launchd path has no quarantine xattr; opencode
      chat clean end-to-end
- [ ] Arc retest after extension reload (Miyago)
