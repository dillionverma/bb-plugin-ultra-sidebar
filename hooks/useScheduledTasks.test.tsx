// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScheduledTasks } from "./useScheduledTasks";

const { rpc } = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, useRealtimeConnectionState: () => "connected" }));
beforeEach(() => { vi.useFakeTimers(); rpc.call.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it("clears stale upcoming data on disconnect and recovers on the next poll", async () => {
  rpc.call.mockResolvedValueOnce({ availability: "ready", entries: [{ id: "one" }] })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ availability: "ready", entries: [{ id: "two" }] });
  const view = renderHook(() => useScheduledTasks());
  await advance(0);
  expect(view.result.current.value?.entries[0]?.id).toBe("one");
  await advance(30_000);
  expect(view.result.current.value).toEqual({ availability: "error", entries: [] });
  await advance(30_000);
  expect(view.result.current.value?.entries[0]?.id).toBe("two");
  view.unmount();
  await advance(90_000);
  expect(rpc.call).toHaveBeenCalledTimes(3);
});

it("does not leave a polling timer after unmount during an inflight request", async () => {
  let resolve!: (value: unknown) => void;
  rpc.call.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useScheduledTasks());
  view.unmount();
  await act(async () => resolve({ availability: "ready", entries: [] }));
  await advance(60_000);
  expect(rpc.call).toHaveBeenCalledTimes(1);
});
