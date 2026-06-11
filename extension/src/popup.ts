import {
  checkHealth,
  fetchProviders,
  streamChat,
  type ChatMessage,
  type ProviderCatalog,
  type UsageStats,
} from "./api";
import {
  captureScreenshot,
  detectVideo,
  extractPage,
  fetchYtTranscript,
  listTabs,
} from "./extract";
import { renderMarkdown } from "./markdown";
import { addUsage, formatUsage, persistUsage } from "./usage";

const FALLBACK_SPEEDS = ["low", "medium", "high"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerEl = $<HTMLSelectElement>("provider");
const modelEl = $<HTMLSelectElement>("model");
const modelCustomEl = $<HTMLInputElement>("model-custom");

const CUSTOM = "__custom__";
const speedEl = $<HTMLSelectElement>("speed");
const tabEl = $<HTMLSelectElement>("tab");
const statusEl = $<HTMLDivElement>("status");
const messagesEl = $<HTMLElement>("messages");
const inputEl = $<HTMLTextAreaElement>("input");
const sendEl = $<HTMLButtonElement>("send");
const clearEl = $<HTMLButtonElement>("clear");
const shotEl = $<HTMLInputElement>("shot");
const videoBarEl = $<HTMLDivElement>("videobar");
const vtransEl = $<HTMLInputElement>("vtrans");
const vnoteEl = $<HTMLSpanElement>("vnote");

let videoIsYouTube = false;

/** Video capture is opt-in: the bar only offers, never auto-extracts. */
async function refreshVideoBar() {
  videoIsYouTube = false;
  videoBarEl.hidden = true;
  vtransEl.checked = false;
  const tabId = Number(tabEl.value);
  if (!Number.isFinite(tabId)) return;
  const info = await detectVideo(tabId);
  if (!info || info.count === 0) return;
  videoBarEl.hidden = false;
  videoIsYouTube = info.isYouTube;
  vtransEl.disabled = !info.isYouTube;
  vnoteEl.textContent = info.isYouTube ? "" : "非 YouTube，無法抓字幕；可改用截圖";
}

let catalog: ProviderCatalog = {};
let history: ChatMessage[] = [];
let busy = false;
let sessionUsage: UsageStats = { input: 0, output: 0, cachedInput: 0 };

function setSessionStatus() {
  setStatus(sessionUsage.input ? `Σ ${formatUsage(sessionUsage)}` : "");
}

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function currentModel(): string {
  return modelEl.value === CUSTOM ? modelCustomEl.value.trim() : modelEl.value;
}

function saveSettings() {
  chrome.storage.local.set({
    settings: {
      provider: providerEl.value,
      model: currentModel(),
      speed: speedEl.value,
      shot: shotEl.checked,
    },
  });
}

/** Populates the model select; unknown stored models land in "custom…". */
function syncModelList(provider: string, restoreModel?: string) {
  const models = catalog[provider]?.models ?? [];
  modelEl.replaceChildren(
    ...models.map((m) => new Option(m.id, m.id)),
    new Option("custom…", CUSTOM),
  );
  if (restoreModel && models.some((m) => m.id === restoreModel)) {
    modelEl.value = restoreModel;
  } else if (restoreModel) {
    modelEl.value = CUSTOM;
    modelCustomEl.value = restoreModel;
  } else {
    modelEl.value = models[0]?.id ?? CUSTOM;
  }
  modelCustomEl.hidden = modelEl.value !== CUSTOM;
  syncSpeeds();
}

/** Speed options come from the selected model's catalog entry. */
function syncSpeeds() {
  const models = catalog[providerEl.value]?.models ?? [];
  const speeds = models.find((m) => m.id === currentModel())?.speeds ?? FALLBACK_SPEEDS;
  const prev = speedEl.value;
  if (speeds.length === 0) {
    speedEl.replaceChildren(
      Object.assign(document.createElement("option"), { value: "medium", textContent: "n/a" }),
    );
    speedEl.disabled = true;
    speedEl.title = catalog[providerEl.value]?.speedNote ?? "";
    return;
  }
  speedEl.disabled = false;
  speedEl.title = "Speed / reasoning effort";
  speedEl.replaceChildren(
    ...speeds.map((s) =>
      Object.assign(document.createElement("option"), { value: s, textContent: s }),
    ),
  );
  speedEl.value = speeds.includes(prev) ? prev : (speeds.includes("medium") ? "medium" : speeds[0]);
}

function addMessage(role: "user" | "assistant", content: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "user") div.textContent = content;
  else div.innerHTML = renderMarkdown(content);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  busy = true;
  sendEl.disabled = true;
  inputEl.value = "";

  history.push({ role: "user", content: text });
  addMessage("user", text);

  const tabId = Number(tabEl.value);
  setStatus("擷取分頁內容…");
  const page = Number.isFinite(tabId) ? await extractPage(tabId) : null;
  const notes: string[] = [];

  if (page && vtransEl.checked && videoIsYouTube) {
    setStatus("擷取影片字幕…");
    const t = await fetchYtTranscript(tabId);
    if ("transcript" in t) {
      page.content += `\n\n<video-transcript title="${t.title ?? ""}" author="${t.author ?? ""}" lang="${t.lang ?? ""}">\n${t.transcript}\n</video-transcript>`;
    } else {
      notes.push(`字幕擷取失敗: ${t.error}`);
    }
  }

  const images: string[] = [];
  if (shotEl.checked) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const shot = tab ? await captureScreenshot(tab) : null;
    if (shot) images.push(shot);
    else notes.push("截圖僅支援作用中分頁，已略過");
  }

  setStatus(
    notes.length
      ? notes.join("；")
      : page
        ? `context: ${page.title || page.url}${images.length ? " + 截圖" : ""}`
        : "此分頁無法擷取，僅以對話內容詢問",
    notes.length > 0 || !page,
  );

  const assistantEl = addMessage("assistant", "");
  assistantEl.classList.add("pending");
  let answer = "";
  let usage: UsageStats | null = null;
  let renderQueued = false;

  const rerender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      assistantEl.innerHTML = renderMarkdown(answer);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  };

  try {
    await streamChat(
      {
        provider: providerEl.value,
        model: currentModel(),
        speed: speedEl.value,
        messages: history,
        page: page ?? undefined,
        images: images.length ? images : undefined,
      },
      (delta) => {
        answer += delta;
        rerender();
      },
      (message) => {
        answer += `\n\n> ⚠ ${message}`;
        rerender();
      },
      (u) => {
        usage = u;
      },
    );
    if (answer) history.push({ role: "assistant", content: answer });
    if (usage) {
      const meta = document.createElement("div");
      meta.className = "usage";
      meta.textContent = formatUsage(usage);
      assistantEl.insertAdjacentElement("afterend", meta);
      sessionUsage = addUsage(sessionUsage, usage);
      setSessionStatus();
      persistUsage(providerEl.value, currentModel(), usage);
    }
  } catch (err) {
    assistantEl.innerHTML = renderMarkdown(`> ⚠ ${String(err)}`);
    setStatus("server 連線失敗，確認 `bun run server` 還活著", true);
  } finally {
    assistantEl.classList.remove("pending");
    busy = false;
    sendEl.disabled = false;
    inputEl.focus();
  }
}

async function init() {
  const alive = await checkHealth();
  if (!alive) {
    setStatus("找不到 local server — 先跑 `bun run server` (127.0.0.1:8787)", true);
  }

  if (alive) {
    catalog = await fetchProviders();
    providerEl.replaceChildren(
      ...Object.entries(catalog).map(([id, p]) =>
        Object.assign(document.createElement("option"), { value: id, textContent: p.label }),
      ),
    );
  }

  const { active, all } = await listTabs();
  tabEl.replaceChildren(
    ...all.map((t) => {
      const opt = document.createElement("option");
      opt.value = String(t.id ?? "");
      const title = t.title || t.url || `tab ${t.id}`;
      opt.textContent = (t.id === active?.id ? "▶ " : "") + title.slice(0, 60);
      return opt;
    }),
  );
  if (active?.id != null) tabEl.value = String(active.id);

  const { settings } = await chrome.storage.local.get("settings");
  if (settings?.provider && catalog[settings.provider]) providerEl.value = settings.provider;
  syncModelList(providerEl.value, settings?.model);
  if (settings?.speed) speedEl.value = settings.speed;
  if (!speedEl.value) syncSpeeds();
  shotEl.checked = settings?.shot ?? false;
  refreshVideoBar();

  providerEl.addEventListener("change", () => {
    syncModelList(providerEl.value);
    saveSettings();
  });
  modelEl.addEventListener("change", () => {
    modelCustomEl.hidden = modelEl.value !== CUSTOM;
    if (modelEl.value === CUSTOM) modelCustomEl.focus();
    syncSpeeds();
    saveSettings();
  });
  modelCustomEl.addEventListener("change", () => {
    syncSpeeds();
    saveSettings();
  });
  speedEl.addEventListener("change", saveSettings);
  shotEl.addEventListener("change", saveSettings);
  tabEl.addEventListener("change", refreshVideoBar);

  sendEl.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter that commits an IME composition (RIME etc.) must not send
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      send();
    }
  });
  clearEl.addEventListener("click", () => {
    history = [];
    sessionUsage = { input: 0, output: 0, cachedInput: 0 };
    messagesEl.replaceChildren();
    setStatus("");
  });

  inputEl.focus();
}

init();
