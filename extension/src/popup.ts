import {
  checkHealth,
  fetchProviders,
  streamChat,
  type ChatMessage,
  type ProviderCatalog,
} from "./api";
import { extractPage, listTabs } from "./extract";
import { renderMarkdown } from "./markdown";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const providerEl = $<HTMLSelectElement>("provider");
const modelEl = $<HTMLInputElement>("model");
const modelListEl = $<HTMLDataListElement>("model-list");
const speedEl = $<HTMLSelectElement>("speed");
const tabEl = $<HTMLSelectElement>("tab");
const statusEl = $<HTMLDivElement>("status");
const messagesEl = $<HTMLElement>("messages");
const inputEl = $<HTMLTextAreaElement>("input");
const sendEl = $<HTMLButtonElement>("send");
const clearEl = $<HTMLButtonElement>("clear");

let catalog: ProviderCatalog = {};
let history: ChatMessage[] = [];
let busy = false;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function saveSettings() {
  chrome.storage.local.set({
    settings: { provider: providerEl.value, model: modelEl.value, speed: speedEl.value },
  });
}

function syncModelList(provider: string, keepValue = false) {
  const models = catalog[provider]?.models ?? [];
  modelListEl.replaceChildren(
    ...models.map((m) => Object.assign(document.createElement("option"), { value: m })),
  );
  if (!keepValue || !modelEl.value) modelEl.value = models[0] ?? "";
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
  setStatus(page ? `context: ${page.title || page.url}` : "此分頁無法擷取，僅以對話內容詢問", !page);

  const assistantEl = addMessage("assistant", "");
  assistantEl.classList.add("pending");
  let answer = "";
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
        model: modelEl.value.trim(),
        speed: speedEl.value,
        messages: history,
        page: page ?? undefined,
      },
      (delta) => {
        answer += delta;
        rerender();
      },
      (message) => {
        answer += `\n\n> ⚠ ${message}`;
        rerender();
      },
    );
    if (answer) history.push({ role: "assistant", content: answer });
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
  syncModelList(providerEl.value, true);
  if (settings?.model) modelEl.value = settings.model;
  if (settings?.speed) speedEl.value = settings.speed;

  providerEl.addEventListener("change", () => {
    syncModelList(providerEl.value);
    saveSettings();
  });
  for (const el of [modelEl, speedEl]) el.addEventListener("change", saveSettings);

  sendEl.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  clearEl.addEventListener("click", () => {
    history = [];
    messagesEl.replaceChildren();
    setStatus("");
  });

  inputEl.focus();
}

init();
