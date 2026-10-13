import { useEffect, useState } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export interface ThreadDiff { additions: number; deletions: number; partial?: boolean }
export type ThreadDiffMap = ReadonlyMap<string, ThreadDiff>;

const EMPTY: ThreadDiffMap = new Map();
const REFRESH_MS = 15_000;
const BATCH_SIZE = 300;

export function useThreadDiffs(threads: readonly PluginSidebarThread[]): ThreadDiffMap {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{ key: string; entries: ThreadDiffMap }>({ key: "", entries: EMPTY });
  const key = JSON.stringify(threads.flatMap(thread => thread.environment?.id == null ? [] : [{
    threadId: thread.id, environmentId: thread.environment.id,
  }]).sort((a, b) => a.threadId.localeCompare(b.threadId)));

  useEffect(() => {
    const targets: { threadId: string; environmentId: string }[] = JSON.parse(key);
    if (targets.length === 0) { setState({ key, entries: EMPTY }); return; }
    let cancelled = false;
    let refreshing = false;
    let timer: number | undefined;

    async function refresh() {
      if (cancelled || refreshing) return;
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const next = new Map<string, ThreadDiff>();
        for (let start = 0; start < targets.length && !cancelled; start += BATCH_SIZE) {
          const result = await rpc.call("threads.diffs", { threads: targets.slice(start, start + BATCH_SIZE) });
          for (const { threadId, ...diff } of result.entries) next.set(threadId, diff);
        }
        if (!cancelled) setState({ key, entries: next });
      } catch {
        if (!cancelled) setState({ key, entries: EMPTY });
      } finally {
        refreshing = false;
        if (!cancelled) timer = window.setTimeout(refresh, REFRESH_MS);
      }
    }

    const onVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    timer = window.setTimeout(refresh, 0);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rpc, key]);

  return state.key === key ? state.entries : EMPTY;
}
