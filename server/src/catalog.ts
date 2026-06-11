import { AUGMENTED_PATH, SPAWN_ENV } from "./env";
import type { ModelInfo, ProviderId } from "./types";
import { parseOpencodeModels } from "./providers/opencode";

export interface ProviderInfo {
  label: string;
  models: ModelInfo[];
  speedNote: string;
}

export type Catalog = Partial<Record<ProviderId, ProviderInfo>>;

/** Aliases verified against claude CLI 2.x; it exposes no catalog command. */
const CLAUDE_MODELS: ModelInfo[] = [
  { id: "fable", label: "Fable (latest)", speeds: [] },
  { id: "opus", label: "Opus (latest)", speeds: [] },
  { id: "sonnet", label: "Sonnet (latest)", speeds: [] },
  { id: "haiku", label: "Haiku (latest)", speeds: [] },
];

/** gemini CLI has no catalog command; observed defaults + free text. */
const GEMINI_MODELS: ModelInfo[] = [
  { id: "auto-gemini-3", label: "Auto (Gemini 3)", speeds: [] },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", speeds: [] },
];

/** Fallback if `codex debug models` fails (offline, version drift). */
const CODEX_FALLBACK: ModelInfo[] = [
  { id: "gpt-5.5", label: "GPT-5.5", speeds: ["low", "medium", "high", "xhigh"] },
];

/** Parses `codex debug models` output; only user-listable models. */
export function parseCodexCatalog(raw: string): ModelInfo[] | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(obj?.models)) return null;
  return obj.models
    .filter((m: any) => m?.visibility === "list" && typeof m?.slug === "string")
    .map((m: any) => ({
      id: m.slug,
      label: m.display_name ?? m.slug,
      speeds: (m.supported_reasoning_levels ?? [])
        .map((l: any) => l?.effort)
        .filter((e: any) => typeof e === "string"),
    }));
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; models: ModelInfo[] }>();

async function cached(
  key: string,
  load: () => Promise<ModelInfo[] | null>,
  fallback: ModelInfo[],
): Promise<ModelInfo[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  try {
    const models = await load();
    if (models?.length) {
      cache.set(key, { at: Date.now(), models });
      return models;
    }
  } catch {
    // fall through
  }
  return fallback;
}

async function cliOutput(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", env: SPAWN_ENV });
  return await new Response(proc.stdout).text();
}

const loadCodexModels = () =>
  cached("codex", async () => parseCodexCatalog(await cliOutput(["codex", "debug", "models"])), CODEX_FALLBACK);

const loadOpencodeModels = () =>
  cached("opencode", async () => parseOpencodeModels(await cliOutput(["opencode", "models"])), []);

interface ProviderDef {
  cli: string;
  label: string;
  speedNote: string;
  models: () => Promise<ModelInfo[]> | ModelInfo[];
}

const PROVIDER_DEFS: Record<ProviderId, ProviderDef> = {
  claude: {
    cli: "claude",
    label: "Claude (claude CLI)",
    speedNote: "speed is ignored by the claude CLI",
    models: () => CLAUDE_MODELS,
  },
  codex: {
    cli: "codex",
    label: "Codex (codex CLI)",
    speedNote: "speed maps to model_reasoning_effort",
    models: loadCodexModels,
  },
  gemini: {
    cli: "gemini",
    label: "Gemini (gemini CLI)",
    speedNote: "speed is ignored by the gemini CLI",
    models: () => GEMINI_MODELS,
  },
  opencode: {
    cli: "opencode",
    label: "OpenCode (opencode CLI)",
    speedNote: "speed not mapped (per-model variants)",
    models: loadOpencodeModels,
  },
};

/** Only providers whose CLI resolves on PATH appear in the catalog. */
export async function getCatalog(): Promise<Catalog> {
  const catalog: Catalog = {};
  for (const [id, def] of Object.entries(PROVIDER_DEFS) as [ProviderId, ProviderDef][]) {
    if (!Bun.which(def.cli, { PATH: AUGMENTED_PATH })) continue;
    const models = await def.models();
    if (id === "opencode" && models.length === 0) continue; // installed but unusable
    catalog[id] = { label: def.label, models, speedNote: def.speedNote };
  }
  return catalog;
}

export function knownProviders(): ProviderId[] {
  return Object.keys(PROVIDER_DEFS) as ProviderId[];
}
