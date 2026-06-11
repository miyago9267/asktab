import type { PageContext } from "./api";
import { parseJson3Transcript, ytTranscriptExtractor, type VideoTranscript } from "./yt";

export interface VideoInfo {
  count: number;
  isYouTube: boolean;
}

/**
 * Runs inside the target page via chrome.scripting — must stay fully
 * self-contained (no imports, no closures over module scope).
 */
function pageExtractor() {
  const root =
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.body;
  const selection = window.getSelection()?.toString().trim() ?? "";
  const text = (root as HTMLElement | null)?.innerText ?? "";
  return {
    url: location.href,
    title: document.title,
    selection: selection.slice(0, 8000),
    content: text.replace(/\n{3,}/g, "\n\n").slice(0, 60000),
  };
}

/** Returns null for non-scriptable pages (chrome://, web store, PDFs). */
export async function extractPage(tabId: number): Promise<PageContext | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageExtractor,
    });
    return (result?.result as PageContext) ?? null;
  } catch {
    return null;
  }
}

export async function listTabs(): Promise<{ active?: chrome.tabs.Tab; all: chrome.tabs.Tab[] }> {
  const all = await chrome.tabs.query({});
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { active, all };
}

function videoDetector() {
  return {
    count: document.querySelectorAll("video").length,
    isYouTube:
      location.hostname.endsWith("youtube.com") &&
      !!new URLSearchParams(location.search).get("v"),
  };
}

export async function detectVideo(tabId: number): Promise<VideoInfo | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: videoDetector,
    });
    return (result?.result as VideoInfo) ?? null;
  } catch {
    return null;
  }
}

/** YouTube transcript via the page's MAIN world (player state lives there). */
export async function fetchYtTranscript(
  tabId: number,
): Promise<VideoTranscript | { error: string }> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: ytTranscriptExtractor,
    });
    const r = result?.result as Awaited<ReturnType<typeof ytTranscriptExtractor>> | null;
    if (!r) return { error: "no result from page" };
    if (r.error) return { error: r.error };
    const transcript = parseJson3Transcript(r.json3).slice(0, 50000);
    if (!transcript) return { error: "empty transcript" };
    return { title: r.title, author: r.author, lang: r.lang, transcript };
  } catch (err) {
    return { error: String(err) };
  }
}

export interface VideoProbe {
  duration: number;
  currentTime: number;
  paused: boolean;
  rect: { x: number; y: number; width: number; height: number };
  dpr: number;
}

/** Pauses the video and reports geometry/state for the frame sampler. */
function videoProber() {
  const v = document.querySelector("video");
  if (!v) return null;
  const wasPaused = v.paused;
  v.pause();
  const r = v.getBoundingClientRect();
  return {
    duration: v.duration,
    currentTime: v.currentTime,
    paused: wasPaused,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    dpr: window.devicePixelRatio,
  };
}

/** Seeks and resolves after the frame has painted (seeked + double rAF). */
function videoSeeker(t: number) {
  const v = document.querySelector("video");
  if (!v) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      v.removeEventListener("seeked", onSeeked);
      resolve(true);
    };
    const onSeeked = () => requestAnimationFrame(() => requestAnimationFrame(finish));
    v.addEventListener("seeked", onSeeked);
    setTimeout(finish, 2500);
    v.currentTime = t;
  });
}

function videoRestorer(t: number, wasPaused: boolean) {
  const v = document.querySelector("video");
  if (!v) return;
  v.currentTime = t;
  if (!wasPaused) void v.play();
}

export async function probeVideo(tabId: number): Promise<VideoProbe | null> {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: videoProber });
    return (r?.result as VideoProbe) ?? null;
  } catch {
    return null;
  }
}

export async function seekVideo(tabId: number, t: number): Promise<void> {
  await chrome.scripting
    .executeScript({ target: { tabId }, func: videoSeeker, args: [t] })
    .catch(() => {});
}

export async function restoreVideo(tabId: number, t: number, paused: boolean): Promise<void> {
  await chrome.scripting
    .executeScript({ target: { tabId }, func: videoRestorer, args: [t, paused] })
    .catch(() => {});
}

/** Captures the visible viewport; only valid when the tab is active. */
export async function captureScreenshot(tab: chrome.tabs.Tab): Promise<string | null> {
  if (!tab.active || tab.windowId == null) return null;
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  } catch {
    return null;
  }
}
