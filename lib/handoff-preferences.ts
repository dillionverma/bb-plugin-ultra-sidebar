const KEY = "bb-workspace-sidebar:handoff-model-usage:v1";
const MAX_ENTRIES = 200;

interface UsageEntry {
  providerId: string;
  model: string;
  count: number;
  lastUsed: number;
}

// Validated by hand: pulling zod into the frontend bundle costs ~450 KB, which
// delays the sidebar replacing bb's list on every load.
function parseEntry(value: unknown): UsageEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const { providerId, model, count, lastUsed } = value as Record<string, unknown>;
  if (typeof providerId !== "string" || typeof model !== "string") return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  if (typeof lastUsed !== "number" || !Number.isFinite(lastUsed) || lastUsed < 0) return null;
  return { providerId, model, count, lastUsed };
}

function readUsage(): UsageEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed) || parsed.length > MAX_ENTRIES) return [];
    const entries = parsed.map(parseEntry);
    return entries.every((entry): entry is UsageEntry => entry !== null) ? entries : [];
  } catch { return []; }
}

export function recordHandoffModel(providerId: string, model: string) {
  const usage = readUsage();
  const previous = usage.find(entry => entry.providerId === providerId && entry.model === model);
  const next = [{ providerId, model, count: (previous?.count ?? 0) + 1, lastUsed: Date.now() },
    ...usage.filter(entry => entry !== previous)].slice(0, MAX_ENTRIES);
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
