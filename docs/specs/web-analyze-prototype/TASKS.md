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
