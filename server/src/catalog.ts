import type { ModelInfo } from "./types";

export interface ProviderInfo {
  label: string;
  models: ModelInfo[];
  speedNote: string;
}

export type Catalog = Record<"claude" | "codex", ProviderInfo>;

/** Aliases verified against claude CLI 2.x; it exposes no catalog command. */
const CLAUDE_MODELS: ModelInfo[] = [
  { id: "fable", label: "Fable (latest)", speeds: [] },
  { id: "opus", label: "Opus (latest)", speeds: [] },
  { id: "sonnet", label: "Sonnet (latest)", speeds: [] },
  { id: "haiku", label: "Haiku (latest)", speeds: [] },
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
let cache: { at: number; models: ModelInfo[] } | null = null;

async function loadCodexModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;
  try {
    const proc = Bun.spawn(["codex", "debug", "models"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    const models = parseCodexCatalog(out);
    if (models?.length) {
      cache = { at: Date.now(), models };
      return models;
    }
  } catch {
    // fall through to fallback
  }
  return CODEX_FALLBACK;
}

export async function getCatalog(): Promise<Catalog> {
  return {
    claude: {
      label: "Claude (claude CLI)",
      models: CLAUDE_MODELS,
      speedNote: "speed is ignored by the claude CLI",
    },
    codex: {
      label: "Codex (codex CLI)",
      models: await loadCodexModels(),
      speedNote: "speed maps to model_reasoning_effort",
    },
  };
}
