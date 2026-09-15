import { z } from "zod";

const KEY = "bb-workspace-sidebar:handoff-model-usage:v1";
const usageSchema = z.array(z.object({
  providerId: z.string(), model: z.string(), count: z.number().int().nonnegative(), lastUsed: z.number().nonnegative(),
})).max(200);

function readUsage() {
  try {
    const parsed = usageSchema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

export function recordHandoffModel(providerId: string, model: string) {
  const usage = readUsage();
  const previous = usage.find(entry => entry.providerId === providerId && entry.model === model);
  const next = [{ providerId, model, count: (previous?.count ?? 0) + 1, lastUsed: Date.now() },
    ...usage.filter(entry => entry !== previous)].slice(0, 200);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
}

export function rankHandoffModels<T extends { id: string }>(providerId: string, models: readonly T[]): T[] {
  const usage = new Map(readUsage().filter(entry => entry.providerId === providerId).map(entry => [entry.model, entry]));
  return [...models].sort((a, b) => {
    const left = usage.get(a.id);
    const right = usage.get(b.id);
    return (right?.count ?? 0) - (left?.count ?? 0) || (right?.lastUsed ?? 0) - (left?.lastUsed ?? 0);
  });
}
