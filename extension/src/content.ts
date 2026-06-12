/**
 * Injected on demand by the background worker. Hosts the AskTab panel as a
 * fixed right-side iframe inside a closed shadow root: the iframe is an
 * extension page, so page CSP and styles cannot reach it, and chrome.*
 * APIs are fully available inside.
 *
 * capture-hide uses opacity on the host: descendants cannot override an
 * ancestor's opacity (unlike visibility), the panel is not painted into
 * captureVisibleTab, and the iframe stays rendered so the panel's JS —
 * the code driving the capture — keeps running.
 */
const FLAG = "__asktabContent";

const MIN_W = 320;
const MAX_W = 900;
const DEFAULT_W = 460;

if (!(window as unknown as Record<string, unknown>)[FLAG]) {
  (window as unknown as Record<string, unknown>)[FLAG] = true;

  let host: HTMLDivElement | null = null;
  let wrap: HTMLDivElement | null = null;
  let open = false;

  const clampW = (w: number) => Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - 80, w));

  const ensureHost = (): HTMLDivElement => {
    if (host && wrap) return wrap;
    host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
.wrap {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: ${DEFAULT_W}px;
  display: flex;
  z-index: 2147483647;
  transform: translateX(100%);
  visibility: hidden;
  /* visibility flips only after the slide-out finishes (and instantly on
     open), so the off-screen box-shadow never leaks into the viewport */
  transition: transform 0.25s ease, visibility 0s linear 0.25s;
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.4);
}
.wrap.open {
  transform: translateX(0);
  visibility: visible;
  transition: transform 0.25s ease;
}
.grip {
  flex: none;
  width: 6px;
  cursor: ew-resize;
  background: #383b46;
  transition: background 0.15s ease;
}
.grip:hover, .grip.dragging {
  background: #7aa2f7;
}
iframe {
  flex: 1;
  height: 100%;
  border: 0;
  background: #1a1b20;
  min-width: 0;
}
.collapse {
  position: absolute;
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 52px;
  border: 1px solid #383b46;
  border-right: 0;
  border-radius: 8px 0 0 8px;
  background: #25262e;
  color: #9a9da8;
  font: 16px/1 sans-serif;
  cursor: pointer;
  padding: 0;
}
.collapse:hover {
  background: #2d2f38;
  color: #e8e8ec;
}`;

    wrap = document.createElement("div");
    wrap.className = "wrap";

    const grip = document.createElement("div");
    grip.className = "grip";

    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("panel.html");

    const collapse = document.createElement("button");
    collapse.className = "collapse";
    collapse.textContent = "»";
    collapse.title = "收合面板";
    collapse.addEventListener("click", () => setOpen(false));

    grip.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("dragging");
      frame.style.pointerEvents = "none";
      const onMove = (ev: PointerEvent) => {
        wrap!.style.width = `${clampW(window.innerWidth - ev.clientX)}px`;
      };
      const onUp = (ev: PointerEvent) => {
        grip.releasePointerCapture(ev.pointerId);
        grip.classList.remove("dragging");
        frame.style.pointerEvents = "";
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        chrome.storage.local.set({ panelWidth: wrap!.getBoundingClientRect().width });
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });

    wrap.append(grip, frame, collapse);
    shadow.append(style, wrap);
    document.documentElement.appendChild(host);

    chrome.storage.local.get("panelWidth").then(({ panelWidth }) => {
      if (typeof panelWidth === "number") wrap!.style.width = `${clampW(panelWidth)}px`;
    });
    return wrap;
  };

  const setOpen = (next: boolean) => {
    const w = ensureHost();
    open = next;
    if (next) {
      // double rAF so the initial off-screen transform paints before sliding in
      requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add("open")));
    } else {
      w.classList.remove("open");
    }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "asktab:toggle") {
      setOpen(!open);
    } else if (msg?.type === "asktab:capture-hide") {
      if (host) host.style.opacity = "0";
    } else if (msg?.type === "asktab:capture-show") {
      if (host) host.style.opacity = "";
    }
    sendResponse(true);
  });
}
