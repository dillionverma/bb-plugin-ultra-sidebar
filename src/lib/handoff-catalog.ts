export interface HandoffOptions {
  providerId: string;
  providers: { id: string; name: string; available: boolean }[];
  models: { id: string; name: string }[];
  error: string | null;
}

export function createHandoffCatalog(read: (providerId: string) => Promise<HandoffOptions>) {
  const entries = new Map<string, { value: HandoffOptions; expires: number }>();
  const pending = new Map<string, Promise<HandoffOptions>>();
  function peek(providerId: string) {
    const entry = entries.get(providerId);
    return entry && entry.expires > Date.now() ? entry.value : undefined;
  }
  function fetch(providerId: string, force = false): Promise<HandoffOptions> {
    if (force) entries.delete(providerId);
    const cached = peek(providerId);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(providerId);
    if (existing) return existing;
    const result = read(providerId).then(value => {
      entries.set(providerId, { value, expires: Date.now() + (value.error ? 15_000 : 300_000) });
      return value;
    }).finally(() => pending.delete(providerId));
    pending.set(providerId, result);
    return result;
  }
  async function warm(providerId: string) {
    const initial = await fetch(providerId);
    await Promise.allSettled(initial.providers.filter(p => p.available && p.id !== providerId).map(p => fetch(p.id)));
  }
  return { peek, fetch, warm };
}
