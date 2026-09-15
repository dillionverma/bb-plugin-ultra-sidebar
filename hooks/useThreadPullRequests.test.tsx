// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useThreadPullRequests } from "./useThreadPullRequests";

const { rpc } = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
const threads = (id: string, env = id) => [{ id, environment: { id: env } }] as PluginSidebarThread[];
const response = (id: string) => ({ entries: [{ threadId: id, number: 1, title: "PR", url: "https://example.com/pr/1", state: "open", attention: "none", checksState: null, failedChecks: 0 }] });
beforeEach(() => { vi.useFakeTimers(); rpc.call.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it("fetches new threads when the list changes during a pending request", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  rpc.call.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(response("new"));
  const view = renderHook(({ rows }) => useThreadPullRequests(rows, true), { initialProps: { rows: threads("old") } });
  await advance(0);
  view.rerender({ rows: threads("new") });
  await act(async () => resolve(response("old")));
  await advance(0);
  expect(view.result.current.get("new")?.state).toBe("open");
  expect(view.result.current.has("old")).toBe(false);
});

it("retries after a failed request without a sidebar rerender", async () => {
  rpc.call.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response("one"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  await advance(90_000);
  expect(view.result.current.get("one")?.state).toBe("open");
});

it("refreshes a replacement thread sharing the same environment", async () => {
  rpc.call.mockResolvedValueOnce(response("one")).mockResolvedValue(response("two"));
  const view = renderHook(({ rows }) => useThreadPullRequests(rows, true), { initialProps: { rows: threads("one", "shared") } });
  await advance(0);
  view.rerender({ rows: threads("two", "shared") });
  await advance(0);
  expect(view.result.current.get("two")?.state).toBe("open");
});

it("polls unchanged threads and stops after unmount", async () => {
  rpc.call.mockResolvedValue(response("one"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  await advance(180_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
  view.unmount();
  await advance(180_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
});
