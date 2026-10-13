import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

interface WorkflowAgent {
  id: string;
  label: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  childThreadId: string | null;
  model: string;
  provider: string;
  createdAt: number;
}

interface WorkflowAgentRun {
  id: string;
  name: string;
  agents: WorkflowAgent[];
}

export interface WorkflowAgentsEntry {
  threadId: string;
  runs: WorkflowAgentRun[];
  unavailable: boolean;
}

/** Present workflow-owned threads to the existing tree without changing BB ownership. */
export function withWorkflowThreads(
  threads: readonly PluginSidebarThread[],
  entries: ReadonlyMap<string, WorkflowAgentsEntry>,
): readonly PluginSidebarThread[] {
  const result = new Map(threads.map(thread => [thread.id, thread]));
  const attached = new Set<string>();
  for (const entry of entries.values()) {
    const origin = result.get(entry.threadId);
    if (!origin || origin.isArchived || entry.unavailable) continue;
    for (const run of entry.runs) for (const agent of run.agents) {
      const id = agent.childThreadId;
      if (!id || id === origin.id || attached.has(id)) continue;
      attached.add(id);
      const existing = result.get(id);
      if (existing) {
        // A future host snapshot may already include the worker. Preserve its
        // live attention/read state, and avoid a duplicate root row.
        if (existing.projectId === origin.projectId && existing.parentThreadId === null)
          result.set(id, { ...existing, parentThreadId: origin.id });
        continue;
      }
      const indicator = agent.status === "running" ? "runtime"
        : agent.status === "succeeded" ? "unread-success"
        : agent.status === "failed" ? "unread-error" : "none";
      const status = agent.status === "running" ? "active" : "idle";
      result.set(id, {
        id, projectId: origin.projectId, parentThreadId: origin.id,
        title: agent.label, titleFallback: null, displayTitle: agent.label, sectionId: null,
        lifecycleOwnerThreadId: null, sourceThreadId: null,
        status, runtimeStatus: status, queuedWork: "none",
        originKind: null, originPluginId: "workflows", providerId: agent.provider,
        hasPendingInteraction: false,
        activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
        indicator, indicatorLabel: agent.status === "running" ? "Thread working"
          : agent.status === "succeeded" ? "Workflow agent completed"
          : agent.status === "failed" ? "Workflow agent failed" : null,
        isUnread: false, isPinned: false, pinnedAt: null, pinSortKey: null,
        isArchived: false, archivedAt: null,
        href: `/projects/${origin.projectId}/threads/${id}`,
        // bb keeps workflow workers out of its own list; this row exists so the
        // tree can nest them under the thread that runs them.
        isHidden: true,
        // Workflow workers reuse their origin's environment by contract.
        environment: origin.environment, host: origin.host,
        createdAt: agent.createdAt, updatedAt: agent.createdAt,
        lastReadAt: null, latestAttentionAt: agent.createdAt,
      });
    }
  }
  return [...result.values()];
}
