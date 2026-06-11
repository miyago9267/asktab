import type { PageContext } from "./api";

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
