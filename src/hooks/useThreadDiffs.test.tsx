// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useThreadDiffs } from "./useThreadDiffs";

const { rpc } = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
const threads = (id: string, env = id) => [{ id, environment: { id: env } }] as PluginSidebarThread[];
const response = (id: string, additions = 5) => ({ entries: [{ threadId: id, additions, deletions: 2 }] });
beforeEach(() => { vi.useFakeTimers(); rpc.call.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it("clears reassigned environment totals and ignores a replaced list's pending response", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  rpc.call.mockResolvedValueOnce(response("one")).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(response("two", 11));
  const view = renderHook(({ rows }) => useThreadDiffs(rows), { initialProps: { rows: threads("one", "old") } });
  await advance(0);
  expect(view.result.current.get("one")?.additions).toBe(5);
  view.rerender({ rows: threads("one", "reassigned") });
  expect(view.result.current.size).toBe(0);
  await advance(0);
  view.rerender({ rows: threads("two") });
  await advance(0);
  await act(async () => resolve(response("one", 99)));
  expect(view.result.current.get("two")?.additions).toBe(11);
  expect(view.result.current.has("one")).toBe(false);
});

it("refreshes counts, clears unavailable totals, retries errors, and stops after unmount", async () => {
  rpc.call.mockResolvedValueOnce(response("one")).mockResolvedValueOnce({ entries: [] }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response("one", 12));
  const view = renderHook(() => useThreadDiffs(threads("one")));
  await advance(0);
  await advance(15_000);
  expect(view.result.current.size).toBe(0);
  await advance(30_000);
  expect(view.result.current.get("one")?.additions).toBe(12);
  view.unmount();
  await advance(30_000);
  expect(rpc.call).toHaveBeenCalledTimes(4);
});

it("pauses polling while hidden and refreshes when mobile returns to the foreground", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  rpc.call.mockResolvedValue(response("one"));
  renderHook(() => useThreadDiffs(threads("one")));
  await advance(60_000);
  expect(rpc.call).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenCalledTimes(1);
});
