import { useCallback, useEffect, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { ScheduledTasksResult } from "../lib/scheduled-tasks";

export function useScheduledTasks() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<ScheduledTasksResult | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(current => current + 1), []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await rpc.call("scheduledTasks.list", null);
        if (!disposed) setValue(result);
      } catch {
        if (!disposed) setValue(current => current?.availability === "ready"
          ? { availability: "error", entries: [] } : current);
      } finally {
        if (!disposed) timer = setTimeout(read, 30_000);
      }
    }
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  }, [rpc, connection, generation]);
  return { value, refresh };
}
