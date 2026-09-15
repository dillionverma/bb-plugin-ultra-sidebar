import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRpc, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { QueueSummary } from "../lib/thread-queue";

const QueueContext = createContext<ReadonlyMap<string, QueueSummary>>(new Map());
export const useThreadQueue = (threadId: string) => useContext(QueueContext).get(threadId);

export function ThreadQueueProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [entries, setEntries] = useState<ReadonlyMap<string, QueueSummary>>(new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await rpc.call("threads.queueSummary", {});
        if (!cancelled) setEntries(new Map(result.entries.map(entry => [entry.threadId, entry])));
      } catch {
        // A disconnected queue must not keep advertising an old scheduled run.
        if (!cancelled) setEntries(new Map());
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 15_000);
      }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rpc, connection]);
  return <QueueContext.Provider value={entries}>{children}</QueueContext.Provider>;
}
