import {
  captureScreenshot,
  probeVideo,
  restoreVideo,
  seekVideo,
  type VideoProbe,
} from "./extract";

const CAPTURE_GAP_MS = 600; // Chrome caps captureVisibleTab at 2/s
const MAX_WIDTH = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/** Crops a full-tab capture to the video rect and downscales it. */
async function captureFrame(tab: chrome.tabs.Tab, probe: VideoProbe): Promise<string | null> {
  const dataUrl = await captureScreenshot(tab);
  if (!dataUrl) return null;
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const { rect, dpr } = probe;
    const sx = Math.max(0, rect.x * dpr);
    const sy = Math.max(0, rect.y * dpr);
    const sw = Math.min(bmp.width - sx, rect.width * dpr);
    const sh = Math.min(bmp.height - sy, rect.height * dpr);
    if (sw < 50 || sh < 50) return dataUrl;
    const scale = Math.min(1, MAX_WIDTH / sw);
    const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return await blobToDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 }));
  } catch {
    return dataUrl; // cropping is best-effort; full screenshot still useful
  }
}

/**
 * Samples frames across the video by seeking the player — the stream
 * buffers as in normal viewing; nothing is downloaded. Playback state is
 * restored afterwards. Live videos degrade to one current-frame capture.
 */
export async function sampleVideoFrames(
  tab: chrome.tabs.Tab,
  count: number,
  onProgress: (done: number, total: number) => void,
): Promise<string[]> {
  if (tab.id == null || !tab.active) return [];
  const probe = await probeVideo(tab.id);
  if (!probe) return [];

  const frames: string[] = [];
  try {
    if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
      const shot = await captureFrame(tab, probe);
      return shot ? [shot] : [];
    }
    let lastCapture = 0;
    for (let i = 0; i < count; i++) {
      onProgress(i + 1, count);
      await seekVideo(tab.id, (probe.duration * (i + 0.5)) / count);
      const wait = CAPTURE_GAP_MS - (Date.now() - lastCapture);
      if (wait > 0) await sleep(wait);
      lastCapture = Date.now();
      const shot = await captureFrame(tab, probe);
      if (shot) frames.push(shot);
    }
  } finally {
    await restoreVideo(tab.id, probe.currentTime, probe.paused);
  }
  return frames;
}
