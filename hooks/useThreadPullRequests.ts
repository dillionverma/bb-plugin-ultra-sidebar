// Pull-request state for the rows currently on screen.
//
// The SDK's own hook is per-row and costs a git-host lookup each time, which
// is fine for a detail card and far too much for labelling every row. This
// goes through our server instead: one batched request per paint, cached
// there by environment.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export interface ThreadPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  attention: string;
  checksState: string | null;
  failedChecks: number;
}

export type PullRequestMap = ReadonlyMap<string, ThreadPullRequest>;

const EMPTY: PullRequestMap = new Map();

/** How long before a thread's PR state is re-checked. */
const REFRESH_MS = 90_000;

/** The server's per-call ceiling; larger lists go up in pieces. */
const BATCH_SIZE = 300;

export function useThreadPullRequests(
  threads: readonly PluginSidebarThread[],
  enabled: boolean,
): PullRequestMap {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<PullRequestMap>(EMPTY);
  // Include thread IDs: replacing a thread can reuse the same environment.
  const key = JSON.stringify(
    threads.flatMap((thread) =>
      thread.environment?.id == null
        ? []
        : [{ threadId: thread.id, environmentId: thread.environment.id }],
    ).sort((a, b) => a.threadId.localeCompare(b.threadId)),
  );

  useEffect(() => {
    if (!enabled) return;
    const targets: { threadId: string; environmentId: string }[] = JSON.parse(key);
    if (targets.length === 0) {
      setEntries(EMPTY);
      return;
    }

    let cancelled = false;
    let timer: number;
    async function refresh() {
      try {
        const batches: (typeof targets)[] = [];
        for (let index = 0; index < targets.length; index += BATCH_SIZE) {
          batches.push(targets.slice(index, index + BATCH_SIZE));
        }
        const results = await Promise.all(
          batches.map((threads) => rpc.call("threads.pullRequests", { threads })),
        );
        if (cancelled) return;
        const next = new Map<string, ThreadPullRequest>();
        for (const result of results) {
          for (const { threadId, ...entry } of result.entries) {
            next.set(threadId, entry);
          }
        }
        setEntries(next);
      } catch {
        // Keep known PRs during a transient failure, and always retry.
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, REFRESH_MS);
      }
    }

    // A changed target list gets its own refresh immediately. Old requests
    // may finish, but cannot overwrite the new list or stop its polling.
    timer = window.setTimeout(refresh, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rpc, key, enabled]);

  return enabled ? entries : EMPTY;
}
