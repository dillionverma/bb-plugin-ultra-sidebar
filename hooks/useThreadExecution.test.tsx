// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useThreadExecution, type ThreadExecution } from "./useThreadExecution";

const { rpc } = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));
beforeEach(() => { rpc.call.mockReset(); });
afterEach(cleanup);

const response = (threadIds: string[]): { entries: (ThreadExecution & { threadId: string })[] } => ({ entries: threadIds.map(threadId => ({
  threadId, model: "gpt-6", permissionMode: "auto", reasoningLevel: null, serviceTier: null,
})) });

it("loads 619 execution entries in batches of at most 300 without duplicate requests", async () => {
  rpc.call.mockImplementation((_method: string, { threadIds }: { threadIds: string[] }) => Promise.resolve(response(threadIds)));
  const rows = Array.from({ length: 619 }, (_, index) => ({ id: `thread-${index}`, updatedAt: 1 }));
  const view = renderHook(() => useThreadExecution(rows, true));
  await waitFor(() => expect(view.result.current.size).toBe(619));
  expect(rpc.call.mock.calls.map(([, input]) => input.threadIds.length)).toEqual([300, 300, 19]);
  view.rerender();
  expect(rpc.call).toHaveBeenCalledTimes(3);
});

it("fetches newly previewed rows while the old request is pending and ignores its late response", async () => {
  let finishFirst: ((result: ReturnType<typeof response>) => void) | undefined;
  rpc.call.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockImplementation((_method: string, { threadIds }: { threadIds: string[] }) => Promise.resolve(response(threadIds)));
  const first = [{ id: "first", updatedAt: 1 }];
  const view = renderHook(({ rows }) => useThreadExecution(rows, true), { initialProps: { rows: first } });
  view.rerender({ rows: [...first, { id: "loaded-more", updatedAt: 1 }] });
  await waitFor(() => expect(view.result.current.get("loaded-more")?.model).toBe("gpt-6"));
  await act(async () => finishFirst?.({ entries: [{ threadId: "first", model: "stale", permissionMode: null, reasoningLevel: null, serviceTier: null }] }));
  expect(view.result.current.get("first")?.model).toBe("gpt-6");
  expect(rpc.call).toHaveBeenCalledTimes(2);
});
