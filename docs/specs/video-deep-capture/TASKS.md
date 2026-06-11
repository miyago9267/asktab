# Tasks — video-deep-capture

## Batch 1: frame sampling (P0)

- [x] extract.ts: video probe / seek-and-wait / restore content-script funcs
- [x] popup: frame sampler (seek → throttled capture → crop → downscale)
- [x] popup: video bar mode select (不擷取 / 字幕 / 影格採樣), wired into send()
- [ ] Manual E2E in Arc: YouTube + generic <video> page (Miyago)

## Batch 2: gemini YouTube pass-through (P1)

- [ ] Probe: does `gemini -p` understand a YouTube URL as native video
      input in headless mode? (verify with timestamp-specific questions)
- [ ] If yes: 「整片分析」 option, gemini-only, no download involved
