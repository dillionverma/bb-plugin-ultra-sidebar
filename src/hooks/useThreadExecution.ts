// Model / permission mode / reasoning level, per thread.
//
// None of this is in the sidebar payload — it only exists behind
// bb.sdk.threads.defaultExecutionOptions on the server, so it comes over our
// own RPC.
//
// Refresh is event-driven, not polled: we remember the `updatedAt` each answer
// was fetched against, and re-ask only for threads the host says have changed
// since. A sidebar that is merely re-rendering costs nothing.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export interface ThreadExecution {
  model: string | null;
  permissionMode: string | null;
  reasoningLevel: string | null;
  serviceTier: string | null;
}

export type ExecutionMap = ReadonlyMap<string, ThreadExecution>;

const EMPTY: ExecutionMap = new Map();
const BATCH_SIZE = 300;

export function useThreadExecution(
  threads: readonly Pick<PluginSidebarThread, "id" | "updatedAt">[],
  enabled: boolean,
): ExecutionMap {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<ExecutionMap>(EMPTY);
  // threadId -> the updatedAt the cached answer was fetched against.
  const fetchedAt = useRef(new Map<string, number>());

  // A primitive key, so this effect fires on real change rather than on every
  // new array identity the host hands us.
  const targetKey = threads
    .map((thread) => `${thread.id}@${thread.updatedAt}`)
    .join(",");

  useEffect(() => {
    if (!enabled || targetKey === "") return;

    const stale = targetKey.split(",").map((part) => {
      const at = part.lastIndexOf("@");
      return { id: part.slice(0, at), updatedAt: Number(part.slice(at + 1)) };
    }).filter(item => fetchedAt.current.get(item.id) !== item.updatedAt);

    let cancelled = false;
    async function fetchExecution() {
      for (let start = 0; start < stale.length && !cancelled; start += BATCH_SIZE) {
        const batch = stale.slice(start, start + BATCH_SIZE);
        try {
          const result = await rpc.call("threads.execution", { threadIds: batch.map(item => item.id) });
          if (cancelled) return;
          for (const item of batch) fetchedAt.current.set(item.id, item.updatedAt);
          setEntries(current => {
            const next = new Map(current);
            for (const entry of result.entries) {
              next.set(entry.threadId, {
                model: entry.model,
                permissionMode: entry.permissionMode,
                reasoningLevel: entry.reasoningLevel,
                serviceTier: entry.serviceTier,
              });
            }
            return next;
          });
        } catch {
          if (cancelled) return;
          for (const item of batch) fetchedAt.current.set(item.id, item.updatedAt);
        }
      }
    }
    void fetchExecution();

    return () => {
      cancelled = true;
    };
  }, [rpc, targetKey, enabled]);

  return enabled ? entries : EMPTY;
}
