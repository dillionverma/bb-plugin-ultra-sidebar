import { ThreadQueueProvider } from "../hooks/useThreadQueue";
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
import { resolveTree, type ResolvedTree, type ThreadNode } from "@/lib/resolve";
import { moveId } from "@/lib/order";
import { type ItemRef } from "@/lib/types";
import { sortableId } from "@/lib/dnd";
import { useSidebarStore } from "@/hooks/useSidebarStore";
import { useSidebarDnd, type DropOutcome } from "@/hooks/useSidebarDnd";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useThreadExecution } from "@/hooks/useThreadExecution";
import { useProjectArtwork } from "@/hooks/useProjectArtwork";
import { useThreadPullRequests } from "@/hooks/useThreadPullRequests";
import { useEnvironmentLocations } from "@/hooks/useEnvironmentLocations";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  buildSections,
  GROUP_BY_OPTIONS,
  visibleThreadIds,
  type GroupBy,
  type Section,
} from "@/lib/sections";
import { ViewOptions } from "./ViewOptions";
import { SidebarFilters } from "./SidebarFilters";
import { useSidebarFilters } from "@/hooks/useSidebarFilters";
import {
  COMPACT_ROWS_KEY,
  GROUP_BY_KEY,
  PROJECT_ICONS_KEY,
  usePersistedChoice,
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
import { SidebarDock } from "./SidebarDock";
import { SidebarSection } from "./SidebarSection";
import { ScrollContainerProvider } from "./scroll-container";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  isFinished,
  isManualStatus,
  statusBucket,
  type ManualStatus,
} from "@/lib/status";
import { revealPaths } from "@/lib/reveal-path";

function SidebarBody(props: PluginThreadListProps) {
  const { activeThreadId, onNavigate } = props;
  const host = experimental_useSidebarThreads();
  const threadActions = experimental_useSidebarThreadActions();
  const store = useSidebarStore();

  const providers = experimental_useProviders();
  const collapsedSections = usePersistedSet(COLLAPSED_SECTIONS_KEY);
  const expandedSubtrees = usePersistedSet(EXPANDED_SUBTREES_KEY);
  const [compactRows, setCompactRows] = usePersistedFlag(COMPACT_ROWS_KEY, true);
  const [projectIcons, setProjectIcons] = usePersistedFlag(PROJECT_ICONS_KEY, true);
  const [showArchived, setShowArchived] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  // Projects are the sidebar's only containers now, so they are also its
  // default shape. A stored "workspace" from before is not in the list and
  // falls back to this.
  const [groupBy, setGroupBy] = usePersistedChoice<GroupBy>(
    GROUP_BY_KEY,
    "project",
    GROUP_BY_OPTIONS,
  );
  const filters = useSidebarFilters();
  const [rowDetails, setRowDetail] = usePersistedDetails(ROW_DETAILS_KEY);
  // The scroll area and its content, for the windowed row lists inside.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The clock the resolver compares snoozes against. It only moves when a
  // snooze is due to end, so a thread comes back at its wake time without the
  // whole list re-rendering on a timer.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const entry of store.state.lifecycle) {
      if (entry.snoozedUntil !== null && entry.snoozedUntil > now) {
        next = Math.min(next, entry.snoozedUntil);
      }
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(next - now + 50, 2_147_000_000),
    );
    return () => clearTimeout(timer);
  }, [store.state.lifecycle, clock]);

  const tree: ResolvedTree = useMemo(
    () =>
      resolveTree({
        status: host.status,
        projects: host.projects,
        threads: host.threads,
        order: store.state.order,
        lifecycle: store.state.lifecycle,
        showArchived,
        now: clock,
      }),
    [
      host.status,
      host.projects,
      host.threads,
      store.state.order,
      store.state.lifecycle,
      showArchived,
      clock,
    ],
  );

  // A snoozed thread that asks for a person or starts working is already
  // back in the list (see wakesEarly). Clear its stored snooze too, or it
  // would vanish again the moment it went quiet, and say why it came back.
  const storeRef = useRef(store);
  storeRef.current = store;
  const wakeNotified = useRef(new Set<string>());
  useEffect(() => {
    if (tree.wokenEarly.length === 0) return;
    storeRef.current.wakeEarly(tree.wokenEarly);
    for (const id of tree.wokenEarly) {
      if (wakeNotified.current.has(id)) continue;
      wakeNotified.current.add(id);
      const thread = host.threads.find((candidate) => candidate.id === id);
      const title = thread?.title ?? thread?.titleFallback ?? "A snoozed thread";
      toast.info(`${title} woke early: it needs you or is working`, {
        id: `sidebar-wake-${id}`,
      });
    }
  }, [tree.wokenEarly, host.threads]);

  const availableProjects = [...host.projects].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const knownProjectIds = new Set(host.projects.map(project => project.id));
  const projectIds = filters.projectIds.filter(id => knownProjectIds.has(id));
  const hasFilters = projectIds.length > 0;
  const scheduledProjectIds = hasFilters ? projectIds : null;
  // Snoozed threads obey the same filter as the list they left.
  const snoozedEntries = tree.snoozed.filter(
    entry => !hasFilters || projectIds.includes(entry.thread.projectId));

  const treeRef = useRef(tree);
  treeRef.current = tree;

  // Every root in the tree as one list: what needs a pull request, a folder
  // path, or a chevron opened does not care which section it ends up in.
  const rootNodes = useMemo(
    () => [...tree.pinned, ...tree.projects.flatMap((group) => group.roots)],
    [tree],
  );

  // bb's implicit personal project is left unnamed on purpose. It is where
  // every thread that belongs to no project lands, so a badge reading
  // "Personal" appears on row after row without telling you anything about
  // any of them. Real projects are still named.
  const projectNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of host.projects) {
      if (project.isPersonal) continue;
      byId.set(project.id, project.name);
    }
    return byId;
  }, [host.projects]);
  // Icons and logos found in each project's files; a search per project,
  // once per window, and only while the option is on.
  const projectArtwork = useProjectArtwork(host.projects, projectIcons);

  const manualStatusById = useMemo(() => {
    const byId = new Map<string, ManualStatus>();
    for (const entry of store.state.lifecycle) {
      if (entry.status !== null) byId.set(entry.threadId, entry.status);
    }
    return byId;
  }, [store.state.lifecycle]);

  const providerById = useMemo(() => {
    const byId = new Map<string, ProviderInfo>();
    for (const provider of providers.providers) byId.set(provider.id, provider);
    return byId;
  }, [providers.providers]);

  // A subagent waiting on the user, or the one the user is looking at, must
  // not be hidden behind a collapsed chevron.
  const expandRef = useRef(expandedSubtrees);
  expandRef.current = expandedSubtrees;
  // Once per reason, then the user's collapse wins. This effect re-runs on
  // every host thread-list push (`tree` depends on host.threads), so an
  // unconditional write would re-open a root seconds after the user closed
  // it — the row would be un-collapsible for as long as it was active or had
  // a subagent waiting.
  const revealedRef = useRef(new Set<string>());
  useEffect(() => {
    const open: string[] = [];
    for (const path of revealPaths(rootNodes, (node) =>
      node.thread.hasPendingInteraction
        ? "pending"
        : node.thread.id === activeThreadId
          ? "active"
          : null,
    )) {
      if (revealedRef.current.has(path.key)) continue;
      revealedRef.current.add(path.key);
      open.push(...path.ancestorIds);
    }
    if (open.length > 0) expandRef.current.addAll(open);
  }, [rootNodes, activeThreadId]);

  // The pull request decides which bucket a thread lands in, and a thread
  // has to be bucketed before anything decides whether it is on screen, so
  // this one covers every root rather than only the visible rows.
  const allRoots = useMemo(
    () => rootNodes.map((node) => node.thread),
    [rootNodes],
  );
  const pullRequests = useThreadPullRequests(allRoots, true);
  // Folder paths for the badges' tooltips and links; fetched once per
  // environment and kept.
  const locations = useEnvironmentLocations(allRoots);

  // Assigned below, once the sections are built: the drop callbacks read it
  // rather than closing over a snapshot, so a drop always measures the list
  // the person is actually looking at.
  const sectionsRef = useRef<Section[]>([]);


  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  // The host owns the pin, so bb's own sidebar and this one never disagree
  // about which threads are pinned.
  const setPinned = useCallback(
    (threadId: string, pinned: boolean) => {
      // A rejected pin used to be swallowed: the row just did not move, which
      // reads as the feature not working rather than as an error.
      threadActions.setPinned(threadId, pinned).catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        toast.error(
          `Couldn't ${pinned ? "pin" : "unpin"} that thread: ${message}`,
          { id: "sidebar-action" },
        );
      });
    },
    [threadActions],
  );
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
   * The ids a section's rows would have after a drop, plus the section that
   * owns them. Threads only order against the threads already beside them:
   * a drag cannot change which project a thread belongs to, so ordering it
   * against a stranger would be a position the resolver could never
   * reproduce.
   */
  const sectionRowIds = useCallback(
    (sectionId: string): string[] | null => {
      const section = sectionsRef.current.find(
        (candidate) => candidate.id === sectionId,
      );
      return section === undefined
        ? null
        : section.roots.map((root) => root.thread.id);
    },
    [],
  );

  /**
   * Turn a resolved drop into edits.
   *
   * It ends by writing the destination section's whole row order, not just
   * the moved row's. That is what makes a drop stick: a lone position among
   * rows that have none would sort back above them, and the row would appear
   * to snap home the moment the server answered.
   */
  const applyDrop = useCallback(
    ({ source, resolution, side }: DropOutcome) =>
      store.batch("Order changed", () => {
        if (source.kind === "project") {
          const ordered = sectionsRef.current
            .map((section) => section.projectId)
            .filter((id): id is string => id !== null);
          if (resolution.anchorRefId === null) return;
          store.reorderGroup(
            "project",
            arrayMove(
              ordered,
              ordered.indexOf(source.refId),
              ordered.indexOf(resolution.anchorRefId),
            ),
          );
          return;
        }

        if (resolution.pin !== null) setPinned(source.refId, resolution.pin);
        if (resolution.bucket !== null) {
          // Only the parked statuses can be set by hand; landing on In
          // progress or In review clears the manual status and lets the pull
          // request decide again.
          store.setStatus(
            [source.refId],
            isManualStatus(resolution.bucket) ? resolution.bucket : null,
          );
        }

        const ids = sectionRowIds(resolution.sectionId);
        // A section with no rows yet — the empty Pinned list, an empty
        // bucket. There is nothing to order against, so the status or pin
        // above is the whole drop.
        if (ids === null) return;
        const anchor = resolution.anchorRefId;
        const next = ids.includes(source.refId)
          ? anchor === null
            ? ids
            : // Inside its own list the rows slid aside as the pointer
              // crossed them, so the drop takes the anchor's index —
              // exactly what the person watched happen.
              arrayMove(ids, ids.indexOf(source.refId), ids.indexOf(anchor))
          : // Arriving from elsewhere, it lands beside the anchor on the
            // side it was released over, or at the end of the list.
            moveId(ids, source.refId, anchor, side);
        store.reorderGroup("thread", next);
      }),
    [store, sectionRowIds, setPinned],
  );

  const dnd = useSidebarDnd({
    onDrop: applyDrop,
    isCollapsed: (sectionId) => collapsedSections.has(sectionId),
    onSpringLoad: (sectionId) => {
      collapsedSections.set(sectionId, false);
    },
  });

  const nudge = useCallback(
    (item: ItemRef, direction: -1 | 1) =>
      store.batch("Order changed", () => {
        if (item.kind === "project") {
          const ordered = sectionsRef.current
            .map((section) => section.projectId)
            .filter((id): id is string => id !== null);
          const index = ordered.indexOf(item.refId);
          if (index === -1) return;
          const neighbour = ordered[index + direction];
          if (neighbour === undefined) return;
          store.reorderGroup(
            "project",
            moveId(
              ordered,
              item.refId,
              neighbour,
              direction < 0 ? "before" : "after",
            ),
          );
          return;
        }
        for (const section of sectionsRef.current) {
          const ids = section.roots.map((root) => root.thread.id);
          const index = ids.indexOf(item.refId);
          if (index === -1) continue;
          const neighbour = ids[index + direction];
          if (neighbour === undefined) return;
          store.reorderGroup(
            "thread",
            moveId(
              ids,
              item.refId,
              neighbour,
              direction < 0 ? "before" : "after",
            ),
          );
          return;
        }
      }),
    [store],
  );

  /** Hand a section's rows back to newest-first. */
  const resetOrder = useCallback(
    (sectionId: string) => {
      const ids = sectionRowIds(sectionId);
      if (ids === null || ids.length === 0) return;
      store.resetOrder("thread", ids);
    },
    [store, sectionRowIds],
  );

  const sections = useMemo(
    () =>
      buildSections({
        tree,
        groupBy,
        projectIds,
        dragging: dnd.state.active,
        bucketOf: (node) =>
          statusBucket(
            manualStatusById.get(node.thread.id) ?? null,
            pullRequests.get(node.thread.id),
          ),
      }),
    [tree, groupBy, projectIds.join(","), dnd.state.active, manualStatusById, pullRequests],
  );
  sectionsRef.current = sections;

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
    for (const section of sections) {
      if (collapsedSections.has(section.id)) continue;
      walk(section.roots);
    }
    return collected;
  }, [
    sections,
    // The set itself is a fresh object literal on every render, so depending
    // on it meant this memo never hit and the whole walk ran on every render.
    collapsedSections.has,
    expandedSubtrees.has,
  ]);

  // The model only exists behind an RPC, so it is fetched only while shown.
  const executions = useThreadExecution(visibleThreads, compactRows || rowDetails.model);
  // Fetch working changes for the rows on screen.
  const threadDiffs = useThreadDiffs(visibleThreads);

  // One stable bundle, so memoized rows stay memoized.
  const contextValue = useMemo<SidebarContextValue>(
    () => ({
      activeThreadId,
      compactRows,
      rowDetails,
      projectNameOf: (projectId: string) =>
        projectNameById.get(projectId) ?? "",
      artworkOf: (projectId: string) =>
        projectArtwork.get(projectId) ?? null,
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
      setPinned: (threadId: string, pinned: boolean) => {
        setPinned(threadId, pinned);
        // A finished thread is never shown pinned (see buildSections), so
        // pinning one reopens it rather than leaving it where it was.
        const manual = manualStatusById.get(threadId);
        if (pinned && manual !== undefined && isFinished(manual)) {
          store.setStatus([threadId], null);
        }
      },
      setRead: (threadId, read) => void threadActions.setRead(threadId, read),
      renameThread: (threadId, title) => {
        void store.history.enqueue(async () => {
          const before = await rpc.call("threads.title", { threadId });
          if (before === title) return;
          await threadActions.rename(threadId, title);
          store.history.record({
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
                void store.history.undo();
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
      nudge,
      resetOrder,
      provider: (providerId: string) => providerById.get(providerId) ?? null,
      isSubtreeExpanded: expandedSubtrees.has,
      toggleSubtree: expandedSubtrees.toggle,
      setSubtreeExpanded: expandedSubtrees.set,
      manualStatusOf: (threadId: string) =>
        manualStatusById.get(threadId) ?? null,
      setStatus: (threadId: string, status: ManualStatus | null) => {
        store.setStatus([threadId], status);
        // Filing a pinned thread away unpins it, exactly as dragging it onto
        // a parked heading does: a pin says "this is what I'm on", and a
        // finished thread holding the top of the list says the opposite.
        if (
          status !== null &&
          treeRef.current.pinned.some((node) => node.thread.id === threadId)
        ) {
          setPinned(threadId, false);
        }
      },
      setSnoozed: store.setSnoozed,
      isSectionCollapsed: collapsedSections.has,
      toggleSection: collapsedSections.toggle,
    }),
    [
      activeThreadId,
      rpc,
      store,
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
      resetOrder,
      providerById,
      expandedSubtrees.has,
      expandedSubtrees.toggle,
      expandedSubtrees.set,
      collapsedSections.has,
      collapsedSections.toggle,
    ],
  );

  if (host.status === "loading" || store.isLoading) {
    return <Skeleton />;
  }

  // One pair of handlers for both the background context menu and the View
  // options popover: they carry the same two labels and the same two icons,
  // and today they do materially different things.
  const collapseAll = () => {
    collapsedSections.replace(sections.map((section) => section.id));
    expandedSubtrees.replace([]);
    // Collapsing everything is a deliberate reset, so a later pending
    // subagent or navigation is allowed to reveal its chain again.
    revealedRef.current.clear();
  };
  const expandAll = () => {
    collapsedSections.replace([]);
    // From the rendered sections rather than host.threads: this keeps
    // archived and filtered ids out of the set, and it opens every level.
    expandedSubtrees.replace(
      visibleThreadIds(
        sections,
        () => true,
        () => true,
      ),
    );
  };

  const sectionIds = sections.map((section) =>
    sortableId({
      kind: section.projectId === null ? "section" : "project",
      refId: section.projectId ?? section.id,
      sectionId: section.id,
    }),
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <ThreadDiffsContext.Provider value={threadDiffs}>
      <ThreadQueueProvider>
      <DndContext {...dnd.contextProps}>
        <DragStateProvider value={dnd.state}>
          <TooltipProvider delayDuration={400} skipDelayDuration={200}>
            <SidebarInteractions
              history={store.history}
              batch={store.batch}
              threadIds={host.threads.map(thread => thread.id)}
              onNewThread={() => {
                const event = new Event("quick-thread:open", { cancelable: true });
                if (window.dispatchEvent(event)) threadActions.openNewThread({ focusPrompt: true });
                onNavigate();
              }}
              onCollapseAll={collapseAll}
              onExpandAll={expandAll}
              onViewOptions={() => requestAnimationFrame(() => setViewOptionsOpen(true))}
            >
              {/* bb keeps the New-thread button, the search action, the plugin nav
            rows and the footer; a replaced list owns the scroll area only, so
            our own controls belong at the top of it. */}
              <ScrollContainerProvider scrollRef={scrollRef} contentRef={contentRef}>
              <div className="bb-ws-body flex min-h-0 flex-1 flex-col overflow-hidden">
              <div ref={scrollRef} className="bb-ws-scroll flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto px-1 pb-2">
              <div ref={contentRef} className="bb-ws-content flex flex-col">
                <div className="bb-ws-toolbar sticky top-0 z-10 flex items-center gap-0.5 bg-sidebar px-1 py-1.5">
                      <SidebarFilters
                        projects={availableProjects}
                        projectIds={projectIds}
                        onProjectsChange={filters.setProjects}
                      />
                      <button
                        type="button"
                        aria-label="New thread"
                        title="New thread"
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
                        <span className="bb-ws-new-thread-label">New thread</span>
                      </button>
                      <SelectionToggle />
                      <ViewOptions
                        open={viewOptionsOpen}
                        onOpenChange={setViewOptionsOpen}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        compactRows={compactRows}
                        onCompactRowsChange={setCompactRows}
                        projectIcons={projectIcons}
                        onProjectIconsChange={setProjectIcons}
                        rowDetails={rowDetails}
                        onRowDetailChange={setRowDetail}
                        showArchived={showArchived}
                        onShowArchivedChange={setShowArchived}
                        onCollapseAll={collapseAll}
                        onExpandAll={expandAll}
                      />
                </div>

                {store.error === null ? null : (
                  <p
                    role="alert"
                    className="px-2 py-1 text-xs text-destructive"
                  >
                    {store.error}
                  </p>
                )}

                <SortableContext
                  items={sectionIds}
                  strategy={verticalListSortingStrategy}
                >
                  {sections.map((section) => (
                    <SidebarSection
                      key={section.id}
                      section={section}
                      executions={executions}
                      pullRequests={pullRequests}
                      isCollapsed={collapsedSections.has(section.id)}
                      onToggle={() => collapsedSections.toggle(section.id)}
                    />
                  ))}
                </SortableContext>

                {sections.every(section => section.threadCount === 0) && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground" role="status">
                    <p>{hasFilters ? "No threads match these filters." : snoozedEntries.length > 0 ? "Everything is snoozed." : "No threads yet."}</p>
                    {hasFilters && <button type="button" className="mt-2 rounded px-2 py-1 text-foreground underline underline-offset-2 hover:bg-accent" onClick={filters.clear}>Clear filters</button>}
                  </div>
                )}
              </div>
              </div>
              <SidebarDock snoozed={snoozedEntries} projectIds={scheduledProjectIds} />
              </div>
              </ScrollContainerProvider>
            </SidebarInteractions>
          </TooltipProvider>
        </DragStateProvider>
      </DndContext>
    </ThreadQueueProvider>
    </ThreadDiffsContext.Provider>
    </SidebarContext.Provider>
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


/**
 * A crash in a replaced thread list is total and silent: bb re-renders its own
 * list and the user is left wondering where their sidebar went. The boundary
 * keeps the failure local — they lose the grouping, not the sidebar.
 */
export function UltraSidebar(props: PluginThreadListProps) {
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
