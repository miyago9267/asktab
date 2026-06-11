import type { UsageStats } from "./api";

export const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function formatUsage(u: UsageStats): string {
  const parts = [`in ${fmt(u.input)}`];
  if (u.cachedInput) parts[0] += ` (cache ${fmt(u.cachedInput)})`;
  parts.push(`out ${fmt(u.output)}`);
  if (u.durationMs) parts.push(`${(u.durationMs / 1000).toFixed(1)}s`);
  if (u.costUsd) parts.push(`$${u.costUsd.toFixed(4)}`);
  return parts.join(" · ");
}

export function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cachedInput: a.cachedInput + b.cachedInput,
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0),
  };
}

/**
 * Accumulates per-day, per-provider/model totals in chrome.storage.local
 * under "usageTotals", so future UI can chart historical consumption.
 */
const KEEP_DAYS = 30;

export async function persistUsage(
  provider: string,
  model: string,
  u: UsageStats,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${provider}/${model}`;
  const { usageTotals = {} } = await chrome.storage.local.get("usageTotals");
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const d of Object.keys(usageTotals)) {
    if (d < cutoff) delete usageTotals[d];
  }
  const slot = usageTotals[day]?.[key] ?? {
    input: 0,
    output: 0,
    cachedInput: 0,
    costUsd: 0,
    requests: 0,
  };
  usageTotals[day] = {
    ...usageTotals[day],
    [key]: {
      input: slot.input + u.input,
      output: slot.output + u.output,
      cachedInput: slot.cachedInput + u.cachedInput,
      costUsd: slot.costUsd + (u.costUsd ?? 0),
      requests: slot.requests + 1,
    },
  };
  await chrome.storage.local.set({ usageTotals });
}

export interface UsageRow {
  key: string;
  requests: number;
  input: number;
  output: number;
  costUsd: number;
}

/** Aggregates stored daily totals per provider/model over the last N days. */
export async function loadUsageRows(days: number): Promise<UsageRow[]> {
  const { usageTotals = {} } = await chrome.storage.local.get("usageTotals");
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const acc = new Map<string, UsageRow>();
  for (const [day, models] of Object.entries(usageTotals) as [string, any][]) {
    if (day < since) continue;
    for (const [key, u] of Object.entries(models) as [string, any][]) {
      const row = acc.get(key) ?? { key, requests: 0, input: 0, output: 0, costUsd: 0 };
      row.requests += u.requests ?? 0;
      row.input += u.input ?? 0;
      row.output += u.output ?? 0;
      row.costUsd += u.costUsd ?? 0;
      acc.set(key, row);
    }
  }
  return [...acc.values()].sort((a, b) => b.input - a.input);
}
