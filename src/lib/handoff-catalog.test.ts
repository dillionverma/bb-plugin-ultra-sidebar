import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandoffCatalog, type HandoffOptions } from "./handoff-catalog";

const providers = [{ id: "codex", name: "Codex", available: true }, { id: "claude", name: "Claude", available: true }, { id: "offline", name: "Offline", available: false }];
const options = (providerId: string): HandoffOptions => ({ providerId, providers, models: [{ id: providerId, name: providerId }], error: null });
afterEach(() => vi.useRealTimers());

describe("handoff catalog preloading", () => {
  it("preloads available providers and serves tab switches synchronously", async () => {
    const read = vi.fn(async (id: string) => options(id));
    const cache = createHandoffCatalog(read);
    await cache.warm("codex");
    expect(cache.peek("claude")?.models).toEqual([{ id: "claude", name: "claude" }]);
    await cache.fetch("claude");
    await cache.fetch("codex");
    expect(read.mock.calls).toEqual([["codex"], ["claude"]]);
  });
  it("coalesces hover, focus, and open requests", async () => {
    let resolve!: (value: HandoffOptions) => void;
    const read = vi.fn(() => new Promise<HandoffOptions>(done => { resolve = done; }));
    const cache = createHandoffCatalog(read);
    const first = cache.fetch("codex");
    const second = cache.fetch("codex");
    expect(first).toBe(second);
    resolve(options("codex"));
    await first;
    expect(read).toHaveBeenCalledOnce();
  });
  it("refreshes expired results and retries failed requests", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async (id: string) => options(id));
    const cache = createHandoffCatalog(read);
    await cache.fetch("codex");
    vi.advanceTimersByTime(300_001);
    expect(cache.peek("codex")).toBeUndefined();
    read.mockRejectedValueOnce(new Error("offline"));
    await expect(cache.fetch("codex")).rejects.toThrow("offline");
    expect(await cache.fetch("codex")).toEqual(options("codex"));
    expect(read).toHaveBeenCalledTimes(3);
  });
});
