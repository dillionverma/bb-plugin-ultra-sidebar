import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const threadDiffSchema = z.object({
  threadId: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  partial: z.boolean().optional(),
});

type Diff = Omit<z.infer<typeof threadDiffSchema>, "threadId">;
type Target = { threadId: string; environmentId: string };
type Environments = Pick<BbPluginApi["sdk"]["environments"], "get" | "status" | "diffFiles">;

const CACHE_MS = 10_000;
const MAX_CACHE_ENTRIES = 1_000;
const CONCURRENCY = 4;

export function createThreadDiffReader(environments: Environments) {
  const cache = new Map<string, { expiresAt: number; value: Diff | null }>();
  const pending = new Map<string, Promise<Diff | null>>();
  const waiting: (() => void)[] = [];
  let active = 0;

  async function load(environmentId: string): Promise<Diff | null> {
    if (active >= CONCURRENCY) await new Promise<void>(resolve => waiting.push(resolve));
    else active += 1;
    let fallback: Diff | null = null;
    try {
      const environment = await environments.get({ environmentId });
      if (!environment.isGitRepo) return null;
      const mergeBaseBranch = environment.mergeBaseBranch ?? environment.baseBranch ?? environment.defaultBranch;
      const result = await environments.status({ environmentId, ...(mergeBaseBranch ? { mergeBaseBranch } : {}) });
      if (result.outcome !== "available") return null;
      const { workingTree, mergeBase } = result.workspace;
      const hasCommittedChanges = mergeBase?.hasCommittedUnmergedChanges === true;
      const hasCombinedChanges = hasCommittedChanges && workingTree.hasUncommittedChanges;
      const stats = hasCommittedChanges && !workingTree.hasUncommittedChanges ? mergeBase : workingTree;
      if (!hasCombinedChanges && stats.lineStatsComplete) {
        return { additions: stats.insertions, deletions: stats.deletions };
      }
      if (!hasCombinedChanges && (stats.insertions > 0 || stats.deletions > 0)) {
        fallback = { additions: stats.insertions, deletions: stats.deletions, partial: true };
      }
      const diff = await environments.diffFiles(hasCommittedChanges && mergeBaseBranch
        ? { environmentId, target: "all", mergeBaseBranch }
        : { environmentId, target: "uncommitted" });
      if (diff.outcome !== "available") return fallback;
      const totals = diff.files.reduce((total, file) => ({
        additions: total.additions + file.additions,
        deletions: total.deletions + file.deletions,
      }), { additions: 0, deletions: 0 });
      if (!diff.truncated) return totals;
      return {
        additions: Math.max(totals.additions, fallback?.additions ?? 0),
        deletions: Math.max(totals.deletions, fallback?.deletions ?? 0),
        partial: true,
      };
    } catch {
      return fallback;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  function read(environmentId: string): Promise<Diff | null> {
    const cached = cache.get(environmentId);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    const existing = pending.get(environmentId);
    if (existing) return existing;
    const request = load(environmentId).then(value => {
      cache.delete(environmentId);
      cache.set(environmentId, { value, expiresAt: Date.now() + CACHE_MS });
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => pending.delete(environmentId));
    pending.set(environmentId, request);
    return request;
  }

  return async (threads: Target[]): Promise<z.infer<typeof threadDiffSchema>[]> => {
    const environmentIds = [...new Set(threads.map(thread => thread.environmentId))];
    const values = new Map(await Promise.all(environmentIds.map(async environmentId =>
      [environmentId, await read(environmentId)] as const)));
    return threads.flatMap(({ threadId, environmentId }) => {
      const value = values.get(environmentId);
      return value ? [{ threadId, ...value }] : [];
    });
  };
}
