import {
  detectTransport,
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
import { addUsage, fmt, formatUsage, loadUsageRows, persistUsage, type UsageRow } from "./usage";

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
const statsEl = $<HTMLElement>("stats");
const statsBtnEl = $<HTMLButtonElement>("stats-btn");
const vtransLabelEl = $<HTMLLabelElement>("vtrans-label");
const vtransEl = $<HTMLInputElement>("vtrans");
const vnoteEl = $<HTMLSpanElement>("vnote");

let videoIsYouTube = false;

/** Video capture is opt-in: the checkbox only offers, never auto-extracts. */
async function refreshVideoBar() {
  videoIsYouTube = false;
  vtransLabelEl.hidden = true;
  vtransEl.checked = false;
  vnoteEl.textContent = "";
  const tabId = Number(tabEl.value);
  if (!Number.isFinite(tabId)) return;
  const info = await detectVideo(tabId);
  if (!info || info.count === 0) return;
  videoIsYouTube = info.isYouTube;
  if (info.isYouTube) vtransLabelEl.hidden = false;
  else vnoteEl.textContent = "偵測到影片（非 YouTube，無字幕可抓）";
}

interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  usage?: UsageStats;
}

let catalog: ProviderCatalog = {};
let transcript: TranscriptEntry[] = [];
let busy = false;
let sessionUsage: UsageStats = { input: 0, output: 0, cachedInput: 0 };

const historyForServer = (): ChatMessage[] =>
  transcript.map(({ role, content }) => ({ role, content }));

/** The popup dies on every blur; the conversation survives in storage. */
function saveSession() {
  chrome.storage.local.set({ session: { transcript, sessionUsage } });
}

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

function usageTable(title: string, rows: UsageRow[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(Object.assign(document.createElement("h3"), { textContent: title }));
  if (!rows.length) {
    frag.appendChild(
      Object.assign(document.createElement("div"), { className: "empty", textContent: "無資料" }),
    );
    return frag;
  }
  const table = document.createElement("table");
  const mkRow = (cells: string[], tag: "th" | "td") => {
    const tr = document.createElement("tr");
    for (const c of cells) tr.appendChild(Object.assign(document.createElement(tag), { textContent: c }));
    return tr;
  };
  table.appendChild(mkRow(["model", "次數", "in", "out", "cost"], "th"));
  const total = { requests: 0, input: 0, output: 0, costUsd: 0 };
  for (const r of rows) {
    table.appendChild(
      mkRow([r.key, String(r.requests), fmt(r.input), fmt(r.output), r.costUsd ? `$${r.costUsd.toFixed(3)}` : "-"], "td"),
    );
    total.requests += r.requests;
    total.input += r.input;
    total.output += r.output;
    total.costUsd += r.costUsd;
  }
  if (rows.length > 1) {
    table.appendChild(
      mkRow(["合計", String(total.requests), fmt(total.input), fmt(total.output), total.costUsd ? `$${total.costUsd.toFixed(3)}` : "-"], "td"),
    );
  }
  frag.appendChild(table);
  return frag;
}

async function toggleStats() {
  if (statsEl.hidden) {
    statsEl.replaceChildren(
      usageTable("今天", await loadUsageRows(1)),
      usageTable("最近 7 天", await loadUsageRows(7)),
      usageTable("最近 30 天", await loadUsageRows(30)),
    );
  }
  statsEl.hidden = !statsEl.hidden;
  messagesEl.hidden = !statsEl.hidden;
  statsBtnEl.textContent = statsEl.hidden ? "統計" : "返回";
}

function appendUsageMeta(el: HTMLElement, usage: UsageStats) {
  const meta = document.createElement("div");
  meta.className = "usage";
  meta.textContent = formatUsage(usage);
  el.insertAdjacentElement("afterend", meta);
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
  if (!statsEl.hidden) {
    statsEl.hidden = true;
    messagesEl.hidden = false;
    statsBtnEl.textContent = "統計";
  }

  busy = true;
  sendEl.disabled = true;
  inputEl.value = "";

  transcript.push({ role: "user", content: text });
  saveSession();
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
        messages: historyForServer(),
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
    if (answer) transcript.push({ role: "assistant", content: answer, usage: usage ?? undefined });
    if (usage) {
      appendUsageMeta(assistantEl, usage);
      sessionUsage = addUsage(sessionUsage, usage);
      setSessionStatus();
      persistUsage(providerEl.value, currentModel(), usage);
    }
    saveSession();
  } catch (err) {
    assistantEl.innerHTML = renderMarkdown(`> ⚠ ${String(err)}`);
    setStatus("backend 連線失敗 — 檢查 install-host 或 dev server", true);
  } finally {
    assistantEl.classList.remove("pending");
    busy = false;
    sendEl.disabled = false;
    inputEl.focus();
  }
}

async function init() {
  const transport = await detectTransport();
  const alive = transport !== "none";
  if (!alive) {
    setStatus("找不到 backend — 執行 `bun run install-host`", true);
  } else if (transport === "native") {
    setStatus("via native host（launchd server 未啟動，opencode 可能觸發 Gatekeeper）");
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

  const { session } = await chrome.storage.local.get("session");
  if (session?.transcript?.length) {
    transcript = session.transcript;
    sessionUsage = session.sessionUsage ?? sessionUsage;
    for (const m of transcript as TranscriptEntry[]) {
      const el = addMessage(m.role, m.content);
      if (m.usage) appendUsageMeta(el, m.usage);
    }
    setSessionStatus();
  }

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
  statsBtnEl.addEventListener("click", toggleStats);
  clearEl.addEventListener("click", () => {
    transcript = [];
    sessionUsage = { input: 0, output: 0, cachedInput: 0 };
    messagesEl.replaceChildren();
    setStatus("");
    chrome.storage.local.remove("session");
  });

  inputEl.focus();
}

init();
