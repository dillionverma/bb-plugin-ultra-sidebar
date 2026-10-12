// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useThreadPullRequests, type ThreadPullRequest } from "./useThreadPullRequests";

const { rpc } = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
const threads = (id: string, env = id) => [{ id, environment: { id: env } }] as PluginSidebarThread[];
const response = (id: string, state: ThreadPullRequest["state"] = "open") => ({ entries: [{ threadId: id, number: 1, title: "PR", url: "https://example.com/pr/1", state, attention: "none", checksState: null, failedChecks: 0 }] });
beforeEach(() => { vi.useFakeTimers(); rpc.call.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
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
  await advance(30_000);
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
  await advance(60_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
  view.unmount();
  await advance(60_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
});

it("shows external close, reopen, and merge changes through polling", async () => {
  rpc.call
    .mockResolvedValueOnce(response("one"))
    .mockResolvedValueOnce(response("one", "closed"))
    .mockResolvedValueOnce(response("one", "open"))
    .mockResolvedValueOnce(response("one", "merged"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  expect(view.result.current.get("one")?.state).toBe("open");
  await advance(30_000);
  expect(view.result.current.get("one")?.state).toBe("closed");
  await advance(30_000);
  expect(view.result.current.get("one")?.state).toBe("open");
  await advance(30_000);
  expect(view.result.current.get("one")?.state).toBe("merged");
});

it("refreshes when returning to the sidebar through focus or visibility", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  rpc.call
    .mockResolvedValueOnce(response("one"))
    .mockResolvedValueOnce(response("one", "closed"))
    .mockResolvedValueOnce(response("one", "merged"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(view.result.current.get("one")?.state).toBe("closed");
  visibility.mockReturnValue("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(view.result.current.get("one")?.state).toBe("merged");
});

it("coalesces focus and visibility refreshes with a pending request", async () => {
  let resolve: (value: ReturnType<typeof response>) => void = () => { throw new Error("No pending request"); };
  rpc.call.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(response("one", "closed"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(60_000);
  expect(rpc.call).toHaveBeenCalledTimes(1);
  await act(async () => resolve(response("one")));
  await advance(30_000);
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(view.result.current.get("one")?.state).toBe("closed");
});

it("retains known PR state during a transient error and cleans up foreground listeners", async () => {
  rpc.call.mockResolvedValueOnce(response("one", "closed")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response("one", "merged"));
  const view = renderHook(() => useThreadPullRequests(threads("one"), true));
  await advance(0);
  await advance(30_000);
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(view.result.current.get("one")?.state).toBe("closed");
  await advance(30_000);
  expect(view.result.current.get("one")?.state).toBe("merged");
  view.unmount();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(60_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
});

it("ignores the old list's response after the new list has refreshed", async () => {
  let resolve: (value: ReturnType<typeof response>) => void = () => { throw new Error("No pending request"); };
  rpc.call.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(response("new", "merged"));
  const view = renderHook(({ rows }) => useThreadPullRequests(rows, true), { initialProps: { rows: threads("old") } });
  await advance(0);
  view.rerender({ rows: threads("new") });
  await advance(0);
  await act(async () => resolve(response("old", "closed")));
  expect(view.result.current.get("new")?.state).toBe("merged");
  expect(view.result.current.has("old")).toBe(false);
  await advance(30_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
});

it("keeps large refresh requests within the server's batch ceiling", async () => {
  const rows = Array.from({ length: 601 }, (_, index) => threads(`thread-${index}`)).flat();
  rpc.call.mockImplementation((_method: string, payload: { threads: { threadId: string }[] }) => Promise.resolve({
    entries: payload.threads.flatMap(({ threadId }) => response(threadId, "closed").entries),
  }));
  const view = renderHook(() => useThreadPullRequests(rows, true));
  await advance(0);
  expect(rpc.call).toHaveBeenCalledTimes(3);
  expect(rpc.call.mock.calls.map(([, payload]) => payload.threads.length)).toEqual([300, 300, 1]);
  expect(view.result.current.size).toBe(601);
  expect(view.result.current.get("thread-600")?.state).toBe("closed");
});

it("disabling PRs cancels pending updates and stops foreground refreshes", async () => {
  let resolve: (value: ReturnType<typeof response>) => void = () => { throw new Error("No pending request"); };
  rpc.call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const view = renderHook(({ enabled }) => useThreadPullRequests(threads("one"), enabled), { initialProps: { enabled: true } });
  await advance(0);
  view.rerender({ enabled: false });
  await act(async () => {
    resolve(response("one", "closed"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(60_000);
  expect(view.result.current.size).toBe(0);
  expect(rpc.call).toHaveBeenCalledTimes(1);
});
