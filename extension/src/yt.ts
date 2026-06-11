export interface VideoTranscript {
  title?: string;
  author?: string;
  lang?: string;
  transcript: string;
}

/** Flattens YouTube timedtext json3 events into plain text. */
export function parseJson3Transcript(data: unknown): string {
  const events = (data as any)?.events;
  if (!Array.isArray(events)) return "";
  return events
    .map((e: any) => (e?.segs ?? []).map((s: any) => s?.utf8 ?? "").join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Runs in the page's MAIN world (ytInitialPlayerResponse is page JS state,
 * invisible to the isolated world). Must stay self-contained.
 */
export async function ytTranscriptExtractor(): Promise<{
  title?: string;
  author?: string;
  lang?: string;
  json3?: unknown;
  error?: string;
}> {
  const pr = (window as any).ytInitialPlayerResponse;
  const videoId = pr?.videoDetails?.videoId;
  const urlId = new URLSearchParams(location.search).get("v");
  if (!videoId || (urlId && videoId !== urlId)) {
    return { error: "stale player state (SPA navigation) — reload the tab" };
  }
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) return { error: "no caption tracks" };
  const track =
    tracks.find((t: any) => t.languageCode?.startsWith("zh")) ??
    tracks.find((t: any) => t.languageCode?.startsWith("en")) ??
    tracks[0];
  try {
    const res = await fetch(`${track.baseUrl}&fmt=json3`);
    if (!res.ok) return { error: `timedtext HTTP ${res.status}` };
    return {
      title: pr?.videoDetails?.title,
      author: pr?.videoDetails?.author,
      lang: track.languageCode,
      json3: await res.json(),
    };
  } catch (err) {
    return { error: String(err) };
  }
}
