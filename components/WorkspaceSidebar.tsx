import { ThreadQueueProvider } from "../hooks/useThreadQueue";
import { NativeSubagentsProvider } from "../hooks/useNativeSubagents";
import { useThreadDiffs } from "../hooks/useThreadDiffs";
import { ThreadDiffsContext } from "./ThreadWorkSummary";
import { SidebarInteractions, useSidebarSelection } from "./SidebarInteractions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { resolveTree, type ResolvedTree, type ThreadNode } from "@/lib/resolve";
import { moveId, type DropTarget } from "@/lib/order";
import type { ItemRef } from "@/lib/types";
import { sortableId } from "@/lib/dnd";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useSidebarDnd, type DropOutcome } from "@/hooks/useSidebarDnd";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useThreadExecution } from "@/hooks/useThreadExecution";
import { useThreadPullRequests } from "@/hooks/useThreadPullRequests";
import { useEnvironmentLocations } from "@/hooks/useEnvironmentLocations";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isSyntheticSectionId, regroup, type GroupBy } from "@/lib/regroup";
import { ViewOptions } from "./ViewOptions";
import {
  COMPACT_ROWS_KEY,
  GROUP_BY_KEY,
  PROJECT_FILTER_KEY,
  usePersistedChoice,
  usePersistedValue,
  COLLAPSED_PROJECTS_KEY,
  COLLAPSED_SECTIONS_KEY,
  EXPANDED_SUBTREES_KEY,
  ROW_DETAILS_KEY,
  usePersistedDetails,
  usePersistedFlag,
  usePersistedSet,
} from "@/hooks/useViewState";
import {
  SidebarContext,
  type ProviderInfo,
  type SidebarContextValue,
} from "./sidebar-context";
import { DragStateProvider } from "./drag-state-context";
import { ScheduledSection } from "./ScheduledSection";
import { WorkspaceSection } from "./WorkspaceSection";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  bucketFromSectionId,
  isManualStatus,
  statusBucket,
  type ManualStatus,
} from "@/lib/status";

function SidebarBody(props: PluginThreadListProps) {
  const { activeThreadId, onNavigate } = props;
  const host = experimental_useSidebarThreads();
  const threadActions = experimental_useSidebarThreadActions();
  const workspaces = useWorkspaces();

  const providers = experimental_useProviders();
  const collapsedSections = usePersistedSet(COLLAPSED_SECTIONS_KEY);
  const expandedSubtrees = usePersistedSet(EXPANDED_SUBTREES_KEY);
  const collapsedProjects = usePersistedSet(COLLAPSED_PROJECTS_KEY);
  const [compactRows, setCompactRows] = usePersistedFlag(COMPACT_ROWS_KEY, true);
  const [showArchived, setShowArchived] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [groupBy, setGroupBy] = usePersistedChoice<GroupBy>(
    GROUP_BY_KEY,
    "status",
    ["status", "workspace", "project"],
  );
  const [projectFilter, setProjectFilter] =
    usePersistedValue(PROJECT_FILTER_KEY);
  const [rowDetails, setRowDetail] = usePersistedDetails(ROW_DETAILS_KEY);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const tree: ResolvedTree = useMemo(
    () =>
      resolveTree({
        status: host.status,
        projects: host.projects,
        threads: host.threads,
        workspaces: workspaces.state.workspaces,
        assignments: workspaces.state.assignments,
        lifecycle: workspaces.state.lifecycle,
        showArchived,
      }),
    [
      host.status,
      host.projects,
      host.threads,
      workspaces.state.workspaces,
      workspaces.state.assignments,
      workspaces.state.lifecycle,
      showArchived,
    ],
  );

  const treeRef = useRef(tree);
  treeRef.current = tree;

  const projectNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of host.projects) byId.set(project.id, project.name);
    return byId;
  }, [host.projects]);

  const manualStatusById = useMemo(() => {
    const byId = new Map<string, ManualStatus>();
    for (const entry of workspaces.state.lifecycle) {
      if (entry.status !== null) byId.set(entry.threadId, entry.status);
    }
    return byId;
  }, [workspaces.state.lifecycle]);

  const providerById = useMemo(() => {
    const byId = new Map<string, ProviderInfo>();
    for (const provider of providers.providers) byId.set(provider.id, provider);
    return byId;
  }, [providers.providers]);

  // A subagent waiting on the user, or the one the user is looking at, must
  // not be hidden behind a collapsed chevron.
  const expandRef = useRef(expandedSubtrees);
  expandRef.current = expandedSubtrees;
  useEffect(() => {
    for (const section of tree.sections) {
      for (const group of section.groups) {
        for (const root of group.roots) {
          const shouldOpen =
            root.hasPendingDescendant || containsThread(root, activeThreadId);
          if (shouldOpen) expandRef.current.set(root.thread.id, true);
        }
      }
    }
  }, [tree, activeThreadId]);

  // Only ask the server about rows that are actually on screen: a collapsed
  // section or subtree is unmounted, so it costs nothing.
  const visibleThreads = useMemo(() => {
    const collected: PluginSidebarThread[] = [];
    const walk = (nodes: readonly ThreadNode[]) => {
      for (const node of nodes) {
        collected.push(node.thread);
        if (!expandedSubtrees.has(node.thread.id)) continue;
        walk(node.children);
      }
    };
    for (const section of tree.sections) {
      if (collapsedSections.has(section.workspaceId ?? "")) continue;
      for (const group of section.groups) {
        if (
          collapsedProjects.has(
            projectKey(section.workspaceId, group.projectId),
          )
        ) {
          continue;
        }
        walk(group.roots);
      }
    }
    return collected;
  }, [tree, collapsedSections, collapsedProjects, expandedSubtrees]);

  // The model only exists behind an RPC, so it is fetched only while shown.
  const executions = useThreadExecution(visibleThreads, compactRows || rowDetails.model);
  // Fetch working changes for the rows on screen.
  const threadDiffs = useThreadDiffs(visibleThreads);
  // The pull request decides which bucket a thread lands in, and a thread
  // has to be bucketed before anything decides whether it is on screen, so
  // this one covers every root rather than only the visible rows.
  const allRoots = useMemo(() => {
    const collected: PluginSidebarThread[] = [];
    for (const section of tree.sections) {
      for (const group of section.groups) {
        for (const root of group.roots) collected.push(root.thread);
      }
    }
    return collected;
  }, [tree]);
  const pullRequests = useThreadPullRequests(allRoots, true);
  // Folder paths for the badges' tooltips and links; fetched once per
  // environment and kept.
  const locations = useEnvironmentLocations(allRoots);

  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const openFolder = useCallback(
    (environmentId: string) => {
      rpc.call("environments.openFolder", { environmentId }).then(
        (result) => {
          if (result.outcome === "remote") {
            toast.info(
              result.hostName === null
                ? `That folder is on another machine: ${result.path}`
                : `That folder is on ${result.hostName}: ${result.path}`,
            );
          }
        },
        (cause: unknown) => {
          const message =
            cause instanceof Error ? cause.message : String(cause);
          toast.error(`Couldn't open that folder: ${message}`);
        },
      );
    },
    [rpc],
  );

  /**
   * Ordered sibling ids for a manual reorder. Threads only order against
   * threads in the same project group, because a drag cannot change which
   * project a thread belongs to — ordering it against a stranger would be a
   * position the resolver could never reproduce.
   */
  const siblingsFor = useCallback(
    (
      kind: ItemRef["kind"],
      workspaceId: string | null,
      anchorRefId: string,
    ): { ids: string[]; owned: (id: string) => boolean } | null => {
      const section = treeRef.current.sections.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (section === undefined) return null;
      if (kind === "project") {
        // Borrowed groups take part in the index math, since they are rows
        // in the list, but only owned ones get a stored position.
        const foreign = new Set(
          section.groups.filter((g) => g.isForeign).map((g) => g.projectId),
        );
        return {
          ids: section.groups.map((group) => group.projectId),
          owned: (id) => !foreign.has(id),
        };
      }
      const group = section.groups.find((candidate) =>
        candidate.roots.some((root) => root.thread.id === anchorRefId),
      );
      if (group === undefined) return null;
      return {
        ids: group.roots.map((root) => root.thread.id),
        owned: () => true,
      };
    },
    [],
  );

  const applyDrop = useCallback(
    ({ source, resolution, side }: DropOutcome) =>
      workspaces.batch("Moved thread or workspace", () => {
        if (resolution.action === "status") {
          // Only the parked statuses can be set by hand; landing on In progress
          // or In review clears the manual status and lets the pull request
          // decide again.
          workspaces.setStatus(
            [source.refId],
            isManualStatus(resolution.bucket) ? resolution.bucket : null,
          );
          return;
        }

        if (source.kind === "workspace") {
          if (resolution.action !== "reorder") return;
          const ordered = treeRef.current.sections
            .map((section) => section.workspaceId)
            .filter(
              (id): id is string => id !== null && !isSyntheticSectionId(id),
            );
          workspaces.reorderWorkspaces(
            arrayMove(
              ordered,
              ordered.indexOf(source.refId),
              ordered.indexOf(resolution.anchorRefId),
            ),
          );
          return;
        }

        const item: ItemRef = { kind: source.kind, refId: source.refId };

        // A thread dragged out of a parked pile into a real workspace is being
        // put back to work; without this it would land back at the bottom.
        if (
          source.kind === "thread" &&
          bucketFromSectionId(source.workspaceId) !== null &&
          manualStatusById.has(source.refId)
        ) {
          workspaces.setStatus([source.refId], null);
        }

        if (resolution.anchorRefId !== null) {
          const siblings = siblingsFor(
            source.kind,
            resolution.workspaceId,
            resolution.anchorRefId,
          );
          if (siblings !== null) {
            // Inside its own list the rows slid aside as the pointer crossed
            // them, so the drop takes the anchor's index — exactly what the
            // person watched happen. Arriving from elsewhere, it lands beside
            // the anchor on the side it was released over.
            const { ids, owned } = siblings;
            const next = ids.includes(source.refId)
              ? arrayMove(
                  ids,
                  ids.indexOf(source.refId),
                  ids.indexOf(resolution.anchorRefId),
                )
              : moveId(ids, source.refId, resolution.anchorRefId, side);
            workspaces.reorderGroup(
              source.kind,
              resolution.workspaceId,
              next.filter(owned),
            );
            // A manual drag is a statement of intent: stop re-sorting this
            // workspace by recency behind the user's back.
            if (source.kind === "thread" && resolution.workspaceId !== null) {
              const workspace = workspaces.state.workspaces.find(
                (candidate) => candidate.id === resolution.workspaceId,
              );
              if (workspace !== undefined && workspace.sortMode !== "manual") {
                workspaces.setSortMode(workspace.id, "manual");
              }
            }
            return;
          }
        }

        const target: DropTarget = {
          workspaceId: resolution.workspaceId,
          anchorRefId: null,
          side: "after",
        };
        // A project cannot be "detached" — with no row it is already Unassigned.
        if (source.kind === "project" && resolution.workspaceId === null) {
          workspaces.clearItems([item]);
          return;
        }
        workspaces.moveItem(item, target);
      }),
    [workspaces, siblingsFor, manualStatusById],
  );

  const dnd = useSidebarDnd({
    onDrop: applyDrop,
    isCollapsed: (workspaceId) => collapsedSections.has(workspaceId ?? ""),
    onSpringLoad: (workspaceId) => {
      collapsedSections.set(workspaceId ?? "", false);
    },
  });

  const nudge = useCallback(
    (item: ItemRef, direction: -1 | 1) =>
      workspaces.batch("Order changed", () => {
        for (const section of treeRef.current.sections) {
          if (item.kind === "project") {
            const owned = section.groups
              .filter((group) => !group.isForeign)
              .map((group) => group.projectId);
            const index = owned.indexOf(item.refId);
            if (index === -1) continue;
            const neighbour = owned[index + direction];
            if (neighbour === undefined) return;
            workspaces.reorderGroup(
              "project",
              section.workspaceId,
              moveId(
                owned,
                item.refId,
                neighbour,
                direction < 0 ? "before" : "after",
              ),
            );
            return;
          }
          for (const group of section.groups) {
            const ids = group.roots.map((root) => root.thread.id);
            const index = ids.indexOf(item.refId);
            if (index === -1) continue;
            const neighbour = ids[index + direction];
            if (neighbour === undefined) return;
            workspaces.reorderGroup(
              "thread",
              section.workspaceId,
              moveId(
                ids,
                item.refId,
                neighbour,
                direction < 0 ? "before" : "after",
              ),
            );
            if (section.workspaceId !== null && section.sortMode !== "manual") {
              workspaces.setSortMode(section.workspaceId, "manual");
            }
            return;
          }
        }
      }),
    [workspaces],
  );

  // One stable bundle, so memoized rows stay memoized.
  const contextValue = useMemo<SidebarContextValue>(
    () => ({
      activeThreadId,
      workspaces: workspaces.state.workspaces,
      compactRows,
      rowDetails,
      projectNameOf: (projectId: string) =>
        projectNameById.get(projectId) ?? "",
      locationOf: (environmentId: string) =>
        locations.get(environmentId) ?? null,
      openFolder,
      // The host declines schemes it does not own; a plain window.open is
      // the fallback so a link never silently does nothing.
      openUrl: (url: string) => {
        if (!navigate.openUrl(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      },
      openThread: (threadId, split) => {
        threadActions.open(threadId, { split });
        onNavigate();
      },
      setPinned: (threadId, pinned) =>
        void threadActions.setPinned(threadId, pinned),
      setRead: (threadId, read) => void threadActions.setRead(threadId, read),
      renameThread: (threadId, title) => {
        void workspaces.history.enqueue(async () => {
          const before = await rpc.call("threads.title", { threadId });
          if (before === title) return;
          await threadActions.rename(threadId, title);
          workspaces.history.record({
            label: "Thread renamed",
            undo: async () => {
              await rpc.call("threads.restoreTitle", {
                threadId,
                expected: title,
                title: before,
              });
            },
            redo: async () => {
              await rpc.call("threads.restoreTitle", {
                threadId,
                expected: before,
                title,
              });
            },
          });
          toast.success("Thread renamed", {
            id: "sidebar-action",
            action: {
              label: "Undo",
              onClick: () => {
                void workspaces.history.undo();
              },
            },
          });
        });
      },
      archiveThread: (threadId) => threadActions.archive(threadId),
      retryThread: (threadId) => {
        void rpc.call("threads.retry", { threadId }).then(
          (result) => {
            toast.success(
              result.delivery === "sent" ? "Retrying" : "Retry queued",
              { id: "sidebar-action" },
            );
          },
          (error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            toast.error(`Couldn't retry: ${message}`, { id: "sidebar-action" });
          },
        );
      },
      // Deletion is recursive; only bb can show the confirmation that counts
      // the child threads, so there is no silent delete here by design.
      deleteThread: (threadId) => threadActions.requestDelete(threadId),
      newThreadIn: (projectId) => {
        threadActions.openNewThread({ projectId, focusPrompt: true });
        onNavigate();
      },
      moveTo: (item, workspaceId) =>
        workspaces.moveItem(item, {
          workspaceId,
          anchorRefId: null,
          side: "after",
        }),
      clearItem: (item) => workspaces.clearItems([item]),
      nudge,
      provider: (providerId: string) => providerById.get(providerId) ?? null,
      isSubtreeExpanded: expandedSubtrees.has,
      toggleSubtree: expandedSubtrees.toggle,
      manualStatusOf: (threadId: string) =>
        manualStatusById.get(threadId) ?? null,
      setStatus: (threadId: string, status: ManualStatus | null) =>
        workspaces.setStatus([threadId], status),
      setSnoozed: workspaces.setSnoozed,
      isProjectCollapsed: (workspaceId: string | null, projectId: string) =>
        collapsedProjects.has(projectKey(workspaceId, projectId)),
      toggleProject: (workspaceId: string | null, projectId: string) =>
        collapsedProjects.toggle(projectKey(workspaceId, projectId)),
      createWorkspace: (name) => void workspaces.createWorkspace(name),
      renameWorkspace: workspaces.renameWorkspace,
      removeWorkspace: (workspaceId) =>
        workspaces.removeWorkspace(workspaceId, "detach"),
      setSortMode: workspaces.setSortMode,
    }),
    [
      activeThreadId,
      rpc,
      workspaces,
      compactRows,
      rowDetails,
      projectNameById,
      locations,
      openFolder,
      navigate,
      manualStatusById,
      threadActions,
      onNavigate,
      nudge,
      providerById,
      expandedSubtrees.has,
      expandedSubtrees.toggle,
      collapsedProjects.has,
      collapsedProjects.toggle,
    ],
  );

  const submitNewWorkspace = () => {
    const name = newName.trim();
    setNewName("");
    setIsCreating(false);
    if (name !== "") void workspaces.createWorkspace(name);
  };

  if (host.status === "loading" || workspaces.isLoading) {
    return <Skeleton />;
  }

  const grouped = regroup({
    sections: tree.sections,
    groupBy,
    projectFilter,
    bucketOf: (node) =>
      statusBucket(
        manualStatusById.get(node.thread.id) ?? null,
        pullRequests.get(node.thread.id),
      ),
  });

  const visibleSections =
    groupBy === "workspace"
      ? grouped.filter(
          (section) =>
            section.workspaceId !== null ||
            section.groups.length > 0 ||
            dnd.state.active,
        )
      : grouped;

  const sectionIds = visibleSections.map((section) =>
    sortableId({
      kind: "workspace",
      refId: section.workspaceId,
      workspaceId: section.workspaceId,
    }),
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <ThreadDiffsContext.Provider value={threadDiffs}>
      <ThreadQueueProvider>
      <NativeSubagentsProvider>
      <DndContext {...dnd.contextProps}>
        <DragStateProvider value={dnd.state}>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <SidebarInteractions
              history={workspaces.history}
              batch={workspaces.batch}
              threadIds={host.threads.map(thread => thread.id)}
              onNewThread={() => {
                const event = new Event("quick-thread:open", { cancelable: true });
                if (window.dispatchEvent(event)) threadActions.openNewThread({ focusPrompt: true });
                onNavigate();
              }}
              onNewWorkspace={() => requestAnimationFrame(() => { setGroupBy("workspace"); setIsCreating(true); })}
              onCollapseAll={() => {
                collapsedSections.replace(visibleSections.map(section => section.workspaceId ?? ""));
                expandedSubtrees.replace([]);
              }}
              onExpandAll={() => {
                collapsedSections.replace([]);
                collapsedProjects.replace([]);
                expandedSubtrees.replace(host.threads.map(thread => thread.id));
              }}
              onViewOptions={() => requestAnimationFrame(() => setViewOptionsOpen(true))}
            >
              {/* bb keeps the New-thread button, the search action, the plugin nav
            rows and the footer; a replaced list owns the scroll area only, so
            our own controls belong at the top of it. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2">
                <div className="sticky top-0 z-10 flex items-center gap-0.5 bg-sidebar px-1 py-1.5">
                  {isCreating ? (
                    <input
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      onBlur={submitNewWorkspace}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submitNewWorkspace();
                        if (event.key === "Escape") {
                          setNewName("");
                          setIsCreating(false);
                        }
                      }}
                      autoFocus
                      placeholder="Workspace name"
                      aria-label="New workspace name"
                      className="min-w-0 flex-1 rounded-md bg-background px-2 py-1 text-xs text-foreground outline-none ring-1 ring-border focus:ring-primary"
                    />
                  ) : (
                    <>
                      {groupBy === "workspace" ? (
                        <ControlButton
                          icon="Plus"
                          label="New workspace"
                          onClick={() => setIsCreating(true)}
                        />
                      ) : null}
                      <span className="flex-1" />
                      <button
                        type="button"
                        className="mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          const event = new Event("quick-thread:open", { cancelable: true });
                          if (window.dispatchEvent(event)) {
                            threadActions.openNewThread({ focusPrompt: true });
                          }
                          onNavigate();
                        }}
                      >
                        <Icon name="Plus" className="size-3.5" />
                        New thread
                      </button>
                      <SelectionToggle />
                      <ViewOptions
                        open={viewOptionsOpen}
                        onOpenChange={setViewOptionsOpen}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        projectFilter={projectFilter}
                        onProjectFilterChange={setProjectFilter}
                        projects={host.projects}
                        compactRows={compactRows}
                        onCompactRowsChange={setCompactRows}
                        rowDetails={rowDetails}
                        onRowDetailChange={setRowDetail}
                        showArchived={showArchived}
                        onShowArchivedChange={setShowArchived}
                        onCollapseAll={() =>
                          collapsedSections.replace(
                            visibleSections.map(
                              (section) => section.workspaceId ?? "",
                            ),
                          )
                        }
                        onExpandAll={() => collapsedSections.replace([])}
                      />
                    </>
                  )}
                </div>

                {workspaces.error === null ? null : (
                  <p
                    role="alert"
                    className="px-2 py-1 text-xs text-destructive"
                  >
                    {workspaces.error}
                  </p>
                )}

                <SortableContext
                  items={sectionIds}
                  strategy={verticalListSortingStrategy}
                >
                  {visibleSections.map((section) => (
                    <WorkspaceSection
                      key={section.workspaceId ?? "__unassigned__"}
                      section={section}
                      executions={executions}
                      pullRequests={pullRequests}
                      isCollapsed={collapsedSections.has(
                        section.workspaceId ?? "",
                      )}
                      onToggle={() =>
                        collapsedSections.toggle(section.workspaceId ?? "")
                      }
                    />
                  ))}
                </SortableContext>

                <ScheduledSection projectFilter={projectFilter} />

                {tree.sections.length === 1 &&
                tree.sections[0]!.groups.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No threads yet.
                  </p>
                ) : null}
              </div>
            </SidebarInteractions>
          </TooltipProvider>
        </DragStateProvider>
      </DndContext>
    </NativeSubagentsProvider>
    </ThreadQueueProvider>
    </ThreadDiffsContext.Provider>
    </SidebarContext.Provider>
  );
}

export function projectKey(
  workspaceId: string | null,
  projectId: string,
): string {
  return `${workspaceId ?? ""}/${projectId}`;
}

function ControlButton({
  icon,
  label,
  onClick,
  isActive = false,
}: {
  icon: string;
  label: string;
  onClick(): void;
  isActive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={isActive}
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
            isActive && "bg-accent/60 text-foreground",
          )}
        >
          <Icon name={icon} className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1.5 px-2 py-2" role="status" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="h-5 animate-pulse rounded bg-muted-foreground/10"
        />
      ))}
    </div>
  );
}

function containsThread(
  node: { thread: { id: string }; children: unknown[] },
  threadId: string | null,
): boolean {
  if (threadId === null) return false;
  if (node.thread.id === threadId) return true;
  return (node.children as (typeof node)[]).some((child) =>
    containsThread(child, threadId),
  );
}

/**
 * A crash in a replaced thread list is total and silent: bb re-renders its own
 * list and the user is left wondering where their workspaces went. The
 * boundary keeps the failure local — they lose the grouping, not the sidebar.
 */
export function WorkspaceSidebar(props: PluginThreadListProps) {
  const Original: ComponentType = props.Original;
  return (
    <ErrorBoundary fallback={<Original />}>
      <SidebarBody {...props} />
    </ErrorBoundary>
  );
}

function SelectionToggle() {
  const selection = useSidebarSelection();
  return <button type="button" className="bb-ws-selection-toggle flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    aria-label={selection.active ? "Exit thread selection" : "Select threads"} aria-pressed={selection.active}
    onClick={() => selection.active ? selection.exit() : selection.enter()}>
    <Icon name="Check" className="size-3.5" />
  </button>;
}
