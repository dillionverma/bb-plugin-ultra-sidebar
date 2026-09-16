import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ScheduledTask, ScheduledTasksResult } from "./scheduled-tasks";

const triggerSchema = z.discriminatedUnion("triggerType", [
  z.object({ triggerType: z.literal("schedule"), cron: z.string(), timezone: z.string() }),
  z.object({ triggerType: z.literal("once"), runAt: z.number().finite() }),
]);
const taskSchema = z.object({
  id: z.string(), projectId: z.string(), projectName: z.string(), name: z.string(),
  enabled: z.boolean(), trigger: triggerSchema.nullable(), nextRunAt: z.number().finite().nullable(),
  lastRunStatus: z.string().nullable(), lastRunAt: z.number().finite().nullable(), lastError: z.string().nullable(),
  threadId: z.string().nullable(), problem: z.string().nullable(),
});
export const scheduledTasksResultSchema = z.object({
  availability: z.enum(["ready", "unavailable", "error"]), entries: z.array(taskSchema),
});

// Keep only the fields needed by the sidebar. No prompts, scripts, execution
// credentials, or machine configuration cross this plugin's frontend boundary.
const overviewSchema = z.object({ automations: z.array(z.object({
  project: z.object({ id: z.string(), name: z.string() }),
  automation: z.object({
    id: z.string(), projectId: z.string(), name: z.string(),
    enabled: z.boolean().optional(), trigger: triggerSchema.optional(),
    nextRunAt: z.number().finite().nullable().optional(),
    lastRunStatus: z.string().nullable().optional(), lastRunAt: z.number().finite().nullable().optional(),
    lastError: z.string().nullable().optional(),
    lastRunThreadId: z.string().nullable().optional(), problem: z.string().nullable().optional(),
    execution: z.object({ targetThreadId: z.string().optional() }).optional(),
  }),
})) });

export function createScheduledTasksReader(plugins: BbPluginApi["sdk"]["plugins"]) {
  let pending: Promise<ScheduledTasksResult> | null = null;
  let cached: ScheduledTasksResult | null = null;
  let expiresAt = 0;
  async function read(): Promise<ScheduledTasksResult> {
    try {
      const data = await plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null, outputSchema: overviewSchema });
      const entries: ScheduledTask[] = data.automations.map(({ automation: task, project }) => ({
        id: task.id, projectId: task.projectId, projectName: project.name, name: task.name,
        enabled: task.enabled ?? false, trigger: task.trigger ?? null, nextRunAt: task.nextRunAt ?? null,
        lastRunStatus: task.lastRunStatus ?? null, lastRunAt: task.lastRunAt ?? null, lastError: task.lastError ?? null,
        // The thread that did the work: the last run's own, else the thread every
        // run is pointed at. Either is what a person means by "open it".
        threadId: task.lastRunThreadId ?? task.execution?.targetThreadId ?? null, problem: task.problem ?? null,
      }));
      return { availability: "ready", entries };
    } catch {
      try {
        const { plugins: installed } = await plugins.list();
        const plugin = installed.find(item => item.id === "automations");
        return { availability: !plugin || !plugin.enabled ? "unavailable" : "error", entries: [] };
      } catch {
        return { availability: "error", entries: [] };
      }
    }
  }
  const list = (): Promise<ScheduledTasksResult> => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached);
    if (pending) return pending;
    pending = read().then(result => { cached = result; expiresAt = Date.now() + 10_000; return result; })
      .finally(() => { pending = null; });
    return pending;
  };
  /** Forget the cached overview, so the next list reflects a run, pause or resume just made. */
  const invalidate = () => { cached = null; expiresAt = 0; };
  return { list, invalidate };
}

/** The automation the sidebar is acting on; the pair the automations plugin keys everything by. */
export const scheduledTaskRefSchema = z.object({ projectId: z.string().min(1), automationId: z.string().min(1) });

/**
 * Run, pause or resume through the automations plugin. The sidebar never
 * edits an automation's prompt or script; those stay in the Automations panel.
 */
export function createScheduledTasksActions(plugins: BbPluginApi["sdk"]["plugins"], invalidate: () => void) {
  const call = async (method: "automations_run" | "automations_pause" | "automations_resume" | "automations_delete", input: { projectId: string; automationId: string }) => {
    try {
      await plugins.callRpc({ pluginId: "automations", method, input, outputSchema: z.unknown() });
    } finally {
      invalidate();
    }
    return { ok: true as const };
  };
  return {
    run: (ref: { projectId: string; automationId: string }) => call("automations_run", ref),
    setEnabled: ({ enabled, ...ref }: { projectId: string; automationId: string; enabled: boolean }) =>
      call(enabled ? "automations_resume" : "automations_pause", ref),
    /** Permanent. The sidebar asks the person twice before calling this. */
    remove: (ref: { projectId: string; automationId: string }) => call("automations_delete", ref),
  };
}
