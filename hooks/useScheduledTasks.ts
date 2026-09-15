import { useCallback, useEffect, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { ScheduledTask, ScheduledTasksResult } from "../lib/scheduled-tasks";

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
  // Each action re-reads straight after, so the row reflects the new state
  // (Running, Paused) without waiting for the next poll.
  const act = useCallback(async (label: string, work: () => Promise<unknown>) => {
    try {
      await work();
      toast.success(label, { id: "sidebar-action" });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      toast.error(`${label} failed: ${message}`, { id: "sidebar-action" });
    } finally {
      refresh();
    }
  }, [refresh]);
  const run = useCallback((task: ScheduledTask) =>
    act(`Started ${task.name}`, () => rpc.call("scheduledTasks.run", { projectId: task.projectId, automationId: task.id })), [act, rpc]);
  const setEnabled = useCallback((task: ScheduledTask, enabled: boolean) =>
    act(enabled ? `Resumed ${task.name}` : `Paused ${task.name}`,
      () => rpc.call("scheduledTasks.setEnabled", { projectId: task.projectId, automationId: task.id, enabled })), [act, rpc]);
  return { value, refresh, run, setEnabled };
}
