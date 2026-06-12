/**
 * Injected on demand by the background worker. Hosts the AskTab panel as a
 * fixed right-side iframe inside a closed shadow root: the iframe is an
 * extension page, so page CSP and styles cannot reach it, and chrome.*
 * APIs are fully available inside.
 *
 * capture-hide uses visibility (not display) so the panel's JS — which is
 * the code driving the capture — keeps running while it is unpainted.
 */
const FLAG = "__asktabContent";

if (!(window as unknown as Record<string, unknown>)[FLAG]) {
  (window as unknown as Record<string, unknown>)[FLAG] = true;

  let host: HTMLDivElement | null = null;
  let open = false;

  const ensureHost = (): HTMLDivElement => {
    if (host) return host;
    host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
iframe {
  position: fixed;
  top: 0;
  right: 0;
  width: 460px;
  height: 100vh;
  border: 0;
  border-left: 1px solid #383b46;
  z-index: 2147483647;
  background: #1a1b20;
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.4);
}`;
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("panel.html");
    shadow.append(style, frame);
    document.documentElement.appendChild(host);
    return host;
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "asktab:toggle") {
      const h = ensureHost();
      open = !open;
      h.style.display = open ? "" : "none";
    } else if (msg?.type === "asktab:capture-hide") {
      if (host) host.style.visibility = "hidden";
    } else if (msg?.type === "asktab:capture-show") {
      if (host) host.style.visibility = "";
    }
    sendResponse(true);
  });
}
