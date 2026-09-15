import { afterEach, describe, expect, it, vi } from "vitest";
import { createThreadDiffReader } from "./thread-diffs.server";

const target = (threadId = "thread", environmentId = "env") => ({ threadId, environmentId });
const environment = { isGitRepo: true, mergeBaseBranch: null, baseBranch: "main", defaultBranch: "main" };
const stats = (insertions = 8, deletions = 3) => ({ insertions, deletions, lineStatsComplete: true });
function fixture({ dirty = true, committed = false } = {}) {
  return {
    get: vi.fn().mockResolvedValue(environment),
    status: vi.fn().mockResolvedValue({ outcome: "available", workspace: {
      workingTree: { ...stats(), hasUncommittedChanges: dirty },
      mergeBase: { ...stats(40, 12), hasCommittedUnmergedChanges: committed },
    } }),
    diffFiles: vi.fn().mockResolvedValue({ outcome: "available", truncated: false, files: [
      { additions: 4, deletions: 1 }, { additions: 2, deletions: 3 },
    ] }),
  };
}

afterEach(() => vi.useRealTimers());

describe("thread diff reader", () => {
  it("uses exact working-tree and clean committed totals without downloading patches", async () => {
    const working = fixture();
    expect(await createThreadDiffReader(working)([target()])).toEqual([{ threadId: "thread", additions: 8, deletions: 3 }]);
    expect(working.diffFiles).not.toHaveBeenCalled();
    const committed = fixture({ dirty: false, committed: true });
    expect(await createThreadDiffReader(committed)([target()])).toEqual([{ threadId: "thread", additions: 40, deletions: 12 }]);
    expect(committed.diffFiles).not.toHaveBeenCalled();
  });

  it("measures the combined diff when uncommitted edits cancel committed changes", async () => {
    const api = fixture({ dirty: true, committed: true });
    api.get.mockResolvedValue({ ...environment, mergeBaseBranch: "develop" });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 6, deletions: 4 }]);
    expect(api.status).toHaveBeenCalledWith({ environmentId: "env", mergeBaseBranch: "develop" });
    expect(api.diffFiles).toHaveBeenCalledWith({ environmentId: "env", target: "all", mergeBaseBranch: "develop" });
  });

  it("deduplicates environments across batches, caches results, and refreshes expired values", async () => {
    vi.useFakeTimers();
    const api = fixture();
    const read = createThreadDiffReader(api);
    const [first, second] = await Promise.all([read([target("a"), target("b")]), read([target("c")])]);
    expect(first.map(entry => entry.threadId)).toEqual(["a", "b"]);
    expect(second[0]?.threadId).toBe("c");
    await read([target()]);
    expect(api.status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await read([target()]);
    expect(api.status).toHaveBeenCalledTimes(2);
  });

  it("bounds concurrent environment reads and isolates offline environments", async () => {
    const api = fixture();
    const resolvers: (() => void)[] = [];
    api.get.mockImplementation(() => new Promise(resolve => resolvers.push(() => resolve(environment))));
    const read = createThreadDiffReader(api);
    const request = read(Array.from({ length: 6 }, (_, index) => target(String(index), String(index))));
    expect(api.get).toHaveBeenCalledTimes(4);
    resolvers.shift()!();
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(5));
    resolvers.shift()!();
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(6));
    resolvers.splice(0).forEach(resolve => resolve());
    expect(await request).toHaveLength(6);
    api.get.mockRejectedValueOnce(new Error("host offline"));
    expect(await read([target("offline", "offline")])).toEqual([]);
  });

  it("keeps a truncated combined diff separate from working-tree and committed totals", async () => {
    const api = fixture({ dirty: true, committed: true });
    api.diffFiles.mockResolvedValue({ outcome: "available", truncated: true, files: [{ additions: 4, deletions: 2 }] });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 4, deletions: 2, partial: true }]);
  });

  it("preserves known unstaged counts when untracked enrichment and the file list are incomplete", async () => {
    const api = fixture();
    api.status.mockResolvedValue({ outcome: "available", workspace: {
      workingTree: { ...stats(8, 3), lineStatsComplete: false, hasUncommittedChanges: true },
      mergeBase: { ...stats(0, 0), hasCommittedUnmergedChanges: false },
    } });
    api.diffFiles.mockResolvedValue({ outcome: "available", truncated: true, files: [{ additions: 80, deletions: 2 }] });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 80, deletions: 3, partial: true }]);
    expect(api.diffFiles).toHaveBeenCalledWith({ environmentId: "env", target: "uncommitted" });
  });

  it("retains all tracked counts when more than 500 tracked files fill the diff list", async () => {
    const api = fixture();
    api.status.mockResolvedValue({ outcome: "available", workspace: {
      workingTree: { ...stats(2_000, 1_100), lineStatsComplete: false, hasUncommittedChanges: true },
      mergeBase: { ...stats(0, 0), hasCommittedUnmergedChanges: false },
    } });
    api.diffFiles.mockResolvedValue({ outcome: "available", truncated: true,
      files: Array.from({ length: 500 }, () => ({ additions: 1, deletions: 1 })),
    });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 2_000, deletions: 1_100, partial: true }]);
  });

  it("reports exact totals when a complete file list fills incomplete status counts", async () => {
    const api = fixture();
    api.status.mockResolvedValue({ outcome: "available", workspace: {
      workingTree: { ...stats(2, 1), lineStatsComplete: false, hasUncommittedChanges: true },
      mergeBase: { ...stats(0, 0), hasCommittedUnmergedChanges: false },
    } });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 6, deletions: 4 }]);
  });

  it.each(["unavailable", "error"])("retains incomplete working-tree counts when enrichment returns %s", async (failure) => {
    const api = fixture();
    api.status.mockResolvedValue({ outcome: "available", workspace: {
      workingTree: { ...stats(8, 3), lineStatsComplete: false, hasUncommittedChanges: true },
      mergeBase: { ...stats(0, 0), hasCommittedUnmergedChanges: false },
    } });
    if (failure === "error") api.diffFiles.mockRejectedValue(new Error("diff timed out"));
    else api.diffFiles.mockResolvedValue({ outcome: "unavailable" });
    expect(await createThreadDiffReader(api)([target()])).toEqual([{ threadId: "thread", additions: 8, deletions: 3, partial: true }]);
  });

  it("omits unavailable combined totals instead of adding counts that can cancel", async () => {
    const api = fixture({ dirty: true, committed: true });
    api.diffFiles.mockResolvedValue({ outcome: "unavailable" });
    expect(await createThreadDiffReader(api)([target()])).toEqual([]);
  });

  it("omits unavailable status and non-Git environments", async () => {
    const api = fixture();
    api.status.mockResolvedValue({ outcome: "unavailable" });
    expect(await createThreadDiffReader(api)([target()])).toEqual([]);
    api.get.mockResolvedValue({ ...environment, isGitRepo: false });
    api.status.mockClear();
    expect(await createThreadDiffReader(api)([target()])).toEqual([]);
    expect(api.status).not.toHaveBeenCalled();
  });
});
