import { isScriptable } from "./restricted";

/**
 * Non-scriptable pages get the popup back via per-tab setPopup; everywhere
 * else the popup is cleared so action clicks reach onClicked and toggle
 * the injected sidebar instead.
 */
const syncActionMode = (tabId: number, url: string | undefined) =>
  chrome.action
    .setPopup({ tabId, popup: isScriptable(url ?? "") ? "" : "popup.html" })
    .catch(() => {});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading" || info.url) syncActionMode(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) syncActionMode(tabId, tab.url);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id == null) return;
  if (!isScriptable(tab.url ?? "")) {
    await syncActionMode(tab.id, tab.url);
    await (chrome.action as { openPopup?: () => Promise<void> }).openPopup?.().catch(() => {});
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "asktab:toggle" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "asktab:toggle" });
  }
});
