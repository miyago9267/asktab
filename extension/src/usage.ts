import type { UsageStats } from "./api";

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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
export async function persistUsage(
  provider: string,
  model: string,
  u: UsageStats,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${provider}/${model}`;
  const { usageTotals = {} } = await chrome.storage.local.get("usageTotals");
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
