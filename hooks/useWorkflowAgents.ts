import { useEffect, useMemo, useState } from "react";
import { useRealtimeConnectionState, useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { WorkflowAgentsEntry } from "../lib/workflow-agents";

export function useWorkflowAgents(threads: readonly PluginSidebarThread[]) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  // Workflow activity counts can be zero while the workflow plugin is busy.
  // Discover origins periodically; refresh only known active runs in between.
  const key = JSON.stringify(threads.filter(thread => !thread.isArchived).map(thread => thread.id).sort());
  const [entries, setEntries] = useState<WorkflowAgentsEntry[]>([]);
  useEffect(() => {
    const ids: string[] = JSON.parse(key);
    if (ids.length === 0) { setEntries([]); return; }
    let disposed = false;
    let pending = false;
    let lastDiscovery = 0;
    const known = new Map<string, WorkflowAgentsEntry>();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      clearTimeout(timer);
      if (disposed || pending || document.visibilityState === "hidden") return;
      pending = true;
      const discover = Date.now() - lastDiscovery >= 30_000;
      const requested = discover ? ids : [...known.keys()];
      if (discover) lastDiscovery = Date.now();
      try {
        for (let i = 0; i < requested.length && !disposed; i += 100) {
          const batch = requested.slice(i, i + 100);
          let entries: WorkflowAgentsEntry[];
          try {
            entries = (await rpc.call("threads.workflowAgents", { threadIds: batch })).entries;
          } catch {
            entries = batch.map(threadId => ({ threadId, runs: [], unavailable: true }));
          }
          for (const entry of entries) {
            if (entry.runs.length || (entry.unavailable && known.has(entry.threadId))) known.set(entry.threadId, entry);
            else known.delete(entry.threadId);
          }
        }
        const next = [...known.values()];
        if (!disposed) setEntries(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } finally {
        pending = false;
        if (!disposed) timer = setTimeout(read, 5000);
      }
    }
    void read();
    const refresh = () => { void read(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [rpc, connection, key]);
  return useMemo(() => {
    const ids = new Set<string>(JSON.parse(key));
    return new Map(entries.filter(entry => ids.has(entry.threadId)).map(entry => [entry.threadId, entry]));
  }, [entries, key]);
}
