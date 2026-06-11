# Tasks — web-analyze prototype

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
