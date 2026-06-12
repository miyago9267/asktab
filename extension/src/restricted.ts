/**
 * Pages where content scripts cannot run (browser-internal schemes, the
 * Web Store); the action falls back to the popup there.
 */
export function isScriptable(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.hostname === "chromewebstore.google.com") return false;
  if (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore")) return false;
  return true;
}
