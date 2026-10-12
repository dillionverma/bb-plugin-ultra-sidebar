import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { WorkflowAgentsEntry } from "./workflow-agents";

const agentSchema = z.object({
  id: z.string(), label: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  childThreadId: z.string().nullable(), model: z.string(),
  provider: z.string(), createdAt: z.number(),
});
export const workflowAgentsResultSchema = z.object({ entries: z.array(z.object({
  threadId: z.string(), unavailable: z.boolean(),
  runs: z.array(z.object({ id: z.string(), name: z.string(), agents: z.array(agentSchema) })),
})) });

// Read the workflow plugin's UI contract. Do not infer ownership from titles
// or expose other hidden threads, prompts, results, or error bodies.
const activeRunsSchema = z.object({ runs: z.array(z.object({
  id: z.string(), name: z.string(),
  phases: z.array(z.object({ calls: z.array(agentSchema) })),
  unphasedCalls: z.array(agentSchema),
})) });

export function createWorkflowAgentsReader(plugins: BbPluginApi["sdk"]["plugins"]) {
  const cache = new Map<string, { expires: number; value: Promise<WorkflowAgentsEntry> }>();
  function read(threadId: string): Promise<WorkflowAgentsEntry> {
    const now = Date.now();
    const cached = cache.get(threadId);
    if (cached && cached.expires > now) return cached.value;
    for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
    const value = plugins.callRpc({ pluginId: "workflows", method: "workflowActiveRuns",
      input: { threadId }, outputSchema: activeRunsSchema,
    }).then(({ runs }) => ({ threadId, unavailable: false, runs: runs.map(run => ({
      id: run.id, name: run.name,
      agents: [...run.phases.flatMap(phase => phase.calls), ...run.unphasedCalls],
    })) }), () => ({ threadId, unavailable: true, runs: [] }));
    cache.set(threadId, { expires: now + 3000, value });
    return value;
  }
  return async (threadIds: string[]) => {
    const ids = [...new Set(threadIds)];
    const entries: WorkflowAgentsEntry[] = [];
    // Bound fan-out even when many workflows are active.
    for (let i = 0; i < ids.length; i += 4) entries.push(...await Promise.all(ids.slice(i, i + 4).map(read)));
    return { entries };
  };
}
