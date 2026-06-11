# Video Deep Capture — Frame Sampling Without Downloads

## What

Extend AskTab's video analysis beyond caption transcripts: sample visual
frames across the whole video so any provider can answer "what happens in
this video", with heavy-usage users accepting the token cost.

## Why / Constraint (ADR-001)

Users perceive tools that download video files (yt-dlp pipelines) as
risky, and downloads sit in a ToS gray zone. Hard requirement: **no file
downloads**. This rules out:

- yt-dlp → gemini full-video upload (rejected: downloads a file)
- yt-dlp + whisper audio transcription (rejected: same, and realtime-only
  tab-audio capture is too slow — deferred indefinitely)

What remains uses only what the browser already streams:

1. **Frame sampling (chosen, P0)** — the content script seeks the `<video>`
   element across N sample points; after each seek the popup captures the
   visible tab and crops to the video's bounding rect. The player buffers
   segments exactly as it would during normal viewing; nothing is written
   to disk beyond the existing screenshot temp files.
2. **Gemini native YouTube URLs (P1, probe first)** — the Gemini API
   accepts YouTube URLs as video input (Google fetches server-side; no
   local download). Unknown whether the gemini CLI passes this through in
   headless mode. Probe before building UI for it.

## Design (P0: frame sampling)

- Video bar checkbox(es) become a mode select: `不擷取` / `字幕` /
  `影格採樣`. Captions stay YouTube-only; frame sampling works on any
  `<video>` (the seek/capture path is site-agnostic).
- Sampler (popup-driven):
  1. Probe: duration, paused state, bounding rect, devicePixelRatio;
     pause the video.
  2. Sample N=8 points at `duration * (i + 0.5) / N`; for each: seek and
     await `seeked` + double rAF (paint), `captureVisibleTab` (throttled
     ≥600 ms — Chrome caps captures at 2/s), crop to video rect scaled by
     DPR, downscale to ≤800 px wide JPEG q70 via OffscreenCanvas.
  3. Restore original currentTime and play state.
- Frames ride the existing `images[]` pipeline — codex `-i` and claude
  Read already handle multiple files; **zero host/server changes**.
- Live videos (`duration` not finite): fall back to a single current-frame
  capture.
- Status line shows `採樣中 i/N…` during the run.

## Limitations (accepted)

- Target tab must be active and visible (captureVisibleTab) — same
  limitation as the existing screenshot channel.
- The popup must stay open during sampling (~5–8 s for 8 frames).
- DRM content (Netflix etc.) may capture as black frames.
- 8 frames ≈ significant image tokens per question; the usage line makes
  the cost visible, which is the agreed trade-off.

## Test Strategy

Sampler is Chrome-API/DOM glue end to end (seek events, tab capture,
canvas) — no unit tests; sample-point math is trivial and inlined.
Verification is manual in Arc per TASKS. (TDD rule #3 disclosure.)

## Out of Scope

- Audio capture/transcription (realtime-only without downloads).
- yt-dlp/ffmpeg pipelines of any kind.
- Scene-change detection for smarter sample points (future).
- Configurable frame count (fixed at 8 for v1).
