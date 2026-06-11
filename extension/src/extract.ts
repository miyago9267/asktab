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

/** Captures the visible viewport; only valid when the tab is active. */
export async function captureScreenshot(tab: chrome.tabs.Tab): Promise<string | null> {
  if (!tab.active || tab.windowId == null) return null;
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  } catch {
    return null;
  }
}
