import { useEffect, useMemo, useRef, useState } from "react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { railElbowPx, railLeftPx } from "@/lib/indent";
import type { ThreadNode } from "@/lib/resolve";
import type { Section } from "@/lib/sections";
import type { ExecutionMap } from "@/hooks/useThreadExecution";
import type { PullRequestMap } from "@/hooks/useThreadPullRequests";
import { guardHandle } from "@/hooks/useSidebarDnd";
import { sectionKey, sortableId, type DndData, type DropZone } from "@/lib/dnd";
import { containsThread } from "@/lib/contains-thread";
import { revealRow } from "@/lib/reveal-row";
import { useSidebar } from "./sidebar-context";
import { useWindowedRows } from "./scroll-container";
import { ThreadRow } from "./ThreadRow";
import { ProjectIcon } from "./ProjectIcon";
import { SectionContextMenu } from "./RowContextMenu";
import {
  RowDropDecor,
  SectionDropDecor,
  useDragActive,
} from "./drag-state-context";
import { StatusIcon } from "./StatusIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Rows keep sliding into place when the list changes under them — a thread
 * bumps to the top, a mark-done removes one — not only while a drag is on.
 * That is `useRowExit` below, which slides the windowed `li` itself.
 *
 * It used to be dnd-kit's layout animation, forced on outside a drag with
 * `wasDragging: true`. That never worked: dnd-kit measures droppable rects
 * only while dragging, so the FLIP it computes on a quiet list is against a
 * rect frozen at the last drop — a row that changed index would jump in from
 * wherever it happened to be during that drag. Left at dnd-kit's default, the
 * animation runs only when the rects behind it are fresh.
 */

/**
 * One dnd-kit node: a row or section that can be picked up, landed on, or
 * both. A node that is neither still registers, so its rows keep their
 * sortable context, but dnd-kit ignores it.
 */
function useSortableZone(
  kind: DropZone["kind"],
  refId: string | null,
  sectionId: string,
  {
    draggable,
    droppable = true,
    projectId = null,
  }: { draggable: boolean; droppable?: boolean; projectId?: string | null },
) {
  const data = useMemo<DndData>(
    () => ({ zone: { kind, refId, sectionId, projectId }, draggable }),
    [kind, refId, sectionId, projectId, draggable],
  );
  const sortable = useSortable({
    id: sortableId(data.zone),
    data,
    disabled: { draggable: !draggable, droppable: !droppable },
  });
  // Memoized so the handle prop stays stable for the memo on ThreadRow.
  const handle = useMemo(
    () => guardHandle(sortable.listeners),
    [sortable.listeners],
  );
  return {
    setNodeRef: sortable.setNodeRef,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
    },
    handle,
    isDragging: sortable.isDragging,
  };
}

interface SubtreeProps {
  node: ThreadNode;
  sectionId: string;
  showProject: boolean;
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
  sectionLabel?: string | null;
}

/**
 * What sits under an expanded thread: its child threads, then the agents it
 * is running inside its own turn, which have no thread of their own.
 */
function SubtreeChildren({
  node,
  sectionId,
  showProject,
  executions,
  pullRequests,
  sectionLabel = null,
}: SubtreeProps) {
  if (node.children.length === 0) return null;
  return (
    <ul
      className="bb-ws-subtree"
      style={
        {
          // Both numbers come from lib/indent.ts so the rail can never drift
          // from the rows it connects. The elbow is no longer a fixed 8px:
          // at a compressed step it has to shrink with the step or it
          // overshoots the child's chevron.
          "--ws-tree-left": `${railLeftPx(node.depth)}px`,
          "--ws-tree-elbow": `${railElbowPx(node.depth)}px`,
        } as React.CSSProperties
      }
    >
      {node.children.map((child) => (
        <ChildSubtree
          key={child.thread.id}
          node={child}
          sectionId={sectionId}
          showProject={showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={sectionLabel}
        />
      ))}
    </ul>
  );
}

/** Where a windowed row sits, and how the window learns its real height. */
interface VirtualSlot {
  index: number;
  /** Distance from the top of the list, in px. */
  offset: number;
  measure: (element: HTMLElement | null) => void;
}

/**
 * A root thread and its subagent descendants, as one sortable node: a
 * subtree always moves with its root, so the root's node is what dnd-kit
 * slides around, children and all.
 *
 * In a windowed list the `li` is placed by the window and the sortable node
 * is the div inside it, so the two transforms — the window's placement and
 * dnd-kit's slide — never fight over one element.
 */
function RootSubtree({
  node,
  sectionId,
  showProject,
  executions,
  pullRequests,
  sectionLabel = null,
  virtual,
  leaving = false,
}: SubtreeProps & { virtual?: VirtualSlot; leaving?: boolean }) {
  const sidebar = useSidebar();
  const expanded = sidebar.isSubtreeExpanded(node.thread.id);
  const { setNodeRef, style, handle, isDragging } = useSortableZone(
    "thread",
    node.thread.id,
    sectionId,
    { draggable: true, projectId: node.thread.projectId },
  );
  const subtree = (
    <>
      <ThreadRow
        node={node}
        showProject={showProject}
        // Passed as a prop rather than read from context so the memo on
        // ThreadRow still bails out for rows whose metadata did not change.
        execution={executions.get(node.thread.id)}
        sectionLabel={sectionLabel}
        pullRequest={pullRequests.get(node.thread.id)}
        dragHandle={handle}
        leaving={leaving}
      />
      {expanded ? (
        <SubtreeChildren
          node={node}
          sectionId={sectionId}
          showProject={showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={sectionLabel}
        />
      ) : null}
    </>
  );
  // The fade goes on a wrapper of its own rather than on the `li` or the
  // sortable node: both of those carry a transform already — the window's
  // placement and dnd-kit's slide — and a keyframe that animates transform
  // would throw the row back to the top of the list as it faded.
  const content = leaving ? (
    <div aria-hidden className="bb-ws-row-leaving">
      {subtree}
    </div>
  ) : (
    subtree
  );
  if (virtual === undefined) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className={cn("relative", isDragging && "z-10 opacity-60")}
      >
        {content}
      </li>
    );
  }
  return (
    <li
      ref={virtual.measure}
      data-index={virtual.index}
      className="absolute left-0 top-0 w-full"
      style={{ transform: `translateY(${virtual.offset}px)` }}
    >
      <div
        ref={setNodeRef}
        style={style}
        className={cn("relative", isDragging && "z-10 opacity-60")}
      >
        {content}
      </div>
    </li>
  );
}

/** Estimated row height before a row has been measured, by row layout. */
const ROW_ESTIMATE_PX = { compact: 32, detailed: 44 } as const;

/** How long a row that left the list stays mounted, fading out in its slot. */
const ROW_EXIT_MS = 150;

/** How long the rows under it then take to close the gap. */
const ROW_SETTLE_MS = 200;

/** A row the list no longer has, still on screen while it fades. */
interface LeavingRow {
  node: ThreadNode;
  /** Where it stood in the list it left, so the gap holds while it fades. */
  index: number;
}

interface RowExit {
  /** The rows to render: the group's, with any fading ghost put back. */
  rows: readonly ThreadNode[];
  /** Which of them are ghosts. */
  leaving: ReadonlySet<string>;
  /** True while the rows are moving, so the slide is worth transitioning. */
  settling: boolean;
}

/**
 * Gives a row the person just filed away a beat to fade out before the rows
 * below it close the gap.
 *
 * Marking a thread done files it in another section, so it vanishes from this
 * one the instant the edit lands. Without this the row is simply absent
 * between two frames and everything under it jumps a row height at once —
 * which reads as the sidebar glitching rather than as the thread leaving. The
 * ghost holds the slot while it fades, and only then does the list settle.
 *
 * Only a hand-filed thread gets one. A row can leave a group for reasons that
 * are not the thread going anywhere — a filter narrowing, a grouping change,
 * a project deselected — and holding a ghost over a view the person just
 * asked for would read as the filter not having worked.
 *
 * Suspended while a drag is on: dnd-kit is already animating those rows, and
 * a second animation over the same movement would double it.
 */
function useRowExit(
  roots: readonly ThreadNode[],
  suspended: boolean,
  wasFiled: (threadId: string) => boolean,
): RowExit {
  const [state, setState] = useState<{
    source: readonly ThreadNode[];
    leaving: readonly LeavingRow[];
    /** Bumped every time the rows moved; each bump extends the slide. */
    settle: number;
  }>({ source: roots, leaving: [], settle: 0 });

  // Derived during render, not in an effect: the ghost has to be in the very
  // commit that dropped the row, or the gap is visible for a frame first.
  if (state.source !== roots) {
    const present = new Set(roots.map((node) => node.thread.id));
    // A thread that came back — undone, or moved back — is not leaving.
    const kept = suspended
      ? []
      : state.leaving.filter((row) => !present.has(row.node.thread.id));
    const gone: LeavingRow[] = [];
    if (!suspended) {
      state.source.forEach((node, index) => {
        if (present.has(node.thread.id)) return;
        if (!wasFiled(node.thread.id)) return;
        if (kept.some((row) => row.node.thread.id === node.thread.id)) return;
        gone.push({ node, index });
      });
    }
    const moved =
      state.source.length !== roots.length ||
      state.source.some((node, i) => node.thread.id !== roots[i]?.thread.id);
    setState({
      source: roots,
      leaving: [...kept, ...gone],
      settle: moved && !suspended ? state.settle + 1 : state.settle,
    });
  }

  const { leaving, settle } = state;
  // Drop the ghosts once they have faded, and let that drop slide too.
  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = setTimeout(
      () =>
        setState((prev) =>
          prev.leaving === leaving
            ? { ...prev, leaving: [], settle: prev.settle + 1 }
            : prev,
        ),
      ROW_EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);

  // Transitions stay off between moves: the rows are placed by transform, and
  // a standing transition would also animate a section above collapsing.
  useEffect(() => {
    if (settle === 0) return;
    const timer = setTimeout(
      () =>
        setState((prev) =>
          prev.settle === settle ? { ...prev, settle: 0 } : prev,
        ),
      ROW_EXIT_MS + ROW_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [settle]);

  const rows = useMemo(() => {
    if (leaving.length === 0) return roots;
    const merged = [...roots];
    for (const row of [...leaving].sort((a, b) => a.index - b.index)) {
      merged.splice(Math.min(row.index, merged.length), 0, row.node);
    }
    return merged;
  }, [roots, leaving]);
  const leavingIds = useMemo(
    () => new Set(leaving.map((row) => row.node.thread.id)),
    [leaving],
  );
  return { rows, leaving: leavingIds, settling: settle > 0 };
}

/**
 * A group's root rows, windowed: only the rows near the viewport are in the
 * DOM, the list reserves the height of the rest. Without a scroll area to
 * window against (jsdom, an unexpected host) every row renders in flow.
 */
function GroupRows({
  roots,
  sectionId,
  showProject,
  executions,
  pullRequests,
  sectionLabel,
  className,
}: {
  roots: readonly ThreadNode[];
  sectionId: string;
  showProject: boolean;
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
  sectionLabel: string | null;
  className?: string;
}) {
  const sidebar = useSidebar();
  const estimate = sidebar.compactRows
    ? ROW_ESTIMATE_PX.compact
    : ROW_ESTIMATE_PX.detailed;
  const isSubtreeExpanded = sidebar.isSubtreeExpanded;
  // The thread is already filed by the time its row is dropped: the same
  // edit that set the status is what took it out of this group.
  const manualStatusOf = sidebar.manualStatusOf;
  const exit = useRowExit(roots, useDragActive(), (threadId) =>
    manualStatusOf(threadId) !== null,
  );
  const windowed = useWindowedRows(exit.rows, {
    keyOf: (node) => node.thread.id,
    // One row's height, even for an expanded subtree. Scaling the estimate by
    // the subtree's row count reserves closer to the truth on paper, but the
    // estimate is a floor the list lays rows out against before it has
    // measured them, and getting it wrong in either direction is what puts
    // one row on top of the next. Measurement is what makes this accurate.
    estimateSize: () => estimate,
  });
  // No cache-clearing on expand/collapse. Dropping every measured height on
  // an expanded-set change looks like it would fix the stale height a
  // collapsed-while-off-screen root keeps, but a still-mounted row only
  // re-reports through its ResizeObserver, which does not fire when nothing
  // resized — so the cleared rows fall back to the one-row estimate and the
  // list draws them on top of each other. A row whose subtree actually opened
  // or closed did change height, so the observer already corrects it.
  // Bring the thread the user is looking at into view when it changed from
  // somewhere other than a click on its row: Mod+[ / Mod+], the palette, a
  // link. A row already on screen is left where it is.
  const revealRef = useRef({ roots: exit.rows, windowed });
  revealRef.current = { roots: exit.rows, windowed };
  const activeThreadId = sidebar.activeThreadId;
  useEffect(() => {
    if (activeThreadId === null) return;
    const { roots, windowed: current } = revealRef.current;
    const rootIndex = roots.findIndex((root) => containsThread(root, activeThreadId));
    if (rootIndex === -1) return;
    return revealRow({
      getScroller: () => revealRef.current.windowed.getScroller(),
      getList: () => revealRef.current.windowed.getList(),
      threadId: activeThreadId,
      rootIndex,
      scrollToIndex: current.scrollToIndex,
    });
    // Re-run when the expanded set changes: the reveal of a deep row races
    // the ancestor chain opening, and revealRow gives up after 8 frames.
  }, [activeThreadId, isSubtreeExpanded]);
  if (!windowed.active) {
    return (
      <ul ref={windowed.listRef} className={className}>
        {exit.rows.map((node) => (
          <RootSubtree
            key={node.thread.id}
            node={node}
            sectionId={sectionId}
            showProject={showProject}
            executions={executions}
            pullRequests={pullRequests}
            sectionLabel={sectionLabel}
            leaving={exit.leaving.has(node.thread.id)}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul
      ref={windowed.listRef}
      className={cn("relative", exit.settling && "bb-ws-rows-settling", className)}
      style={{ height: windowed.totalSize }}
    >
      {windowed.items.map((item) => {
        const node = windowed.rowAt(item);
        return (
          <RootSubtree
            key={node.thread.id}
            node={node}
            sectionId={sectionId}
            showProject={showProject}
            executions={executions}
            pullRequests={pullRequests}
            sectionLabel={sectionLabel}
            leaving={exit.leaving.has(node.thread.id)}
            virtual={{
              index: item.index,
              offset: windowed.offsetOf(item),
              measure: windowed.measure,
            }}
          />
        );
      })}
    </ul>
  );
}

/** A subagent row. Not draggable: it has no place of its own to be dropped. */
function ChildSubtree({
  node,
  sectionId,
  showProject,
  executions,
  pullRequests,
  sectionLabel = null,
}: SubtreeProps) {
  const sidebar = useSidebar();
  const expanded = sidebar.isSubtreeExpanded(node.thread.id);
  return (
    <li>
      <ThreadRow
        node={node}
        showProject={showProject}
        execution={executions.get(node.thread.id)}
        sectionLabel={sectionLabel}
        pullRequest={pullRequests.get(node.thread.id)}
      />
      {expanded ? (
        <SubtreeChildren
          node={node}
          sectionId={sectionId}
          showProject={showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={sectionLabel}
        />
      ) : null}
    </li>
  );
}

/** The glyph beside a heading: the bucket's, the project's, or a pin. */
function SectionGlyph({ section }: { section: Section }) {
  if (section.kind === "status" && section.bucket !== null) {
    return <StatusIcon tone={section.bucket} className="size-3.5 shrink-0" />;
  }
  if (section.kind === "pinned") {
    return (
      <Icon name="Pin" className="size-3.5 shrink-0 text-muted-foreground/70" />
    );
  }
  if (section.projectId !== null) {
    return (
      <ProjectIcon
        projectId={section.projectId}
        className="size-3.5 shrink-0 opacity-80"
      />
    );
  }
  return null;
}

/**
 * One heading and the root rows beneath it.
 *
 * A project heading is draggable: projects order against each other. A status
 * bucket and Pinned are not — their order is fixed — but all three are drop
 * targets, because dropping into one is how a thread is filed, pinned or
 * released.
 */
export function SidebarSection({
  section,
  isCollapsed,
  onToggle,
  executions,
  pullRequests,
}: {
  section: Section;
  isCollapsed: boolean;
  onToggle(): void;
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
}) {
  const projectId = section.kind === "project" ? section.projectId : null;
  // The section is the wide target: a thread dropped anywhere inside it —
  // including on the heading — lands here. A project heading registers a
  // second, narrower node on top of it, because projects order against each
  // other and a thread row must not be what one of them lands on. A status
  // or Pinned heading gets no node of its own: it has no order to change, and
  // a second node keyed on the same section would collide with this one.
  const body = useSortableZone("section", section.id, section.id, {
    draggable: false,
  });
  const heading = useSortableZone("project", projectId, section.id, {
    draggable: projectId !== null,
    droppable: projectId !== null,
  });
  const threadIds = useMemo(
    () =>
      section.roots.map((root) =>
        sortableId({
          kind: "thread",
          refId: root.thread.id,
          sectionId: section.id,
        }),
      ),
    [section.roots, section.id],
  );

  return (
    <section
      ref={body.setNodeRef}
      className={cn("relative mb-1", heading.isDragging && "z-10 opacity-60")}
      style={heading.style}
    >
      <SectionDropDecor sectionKey={sectionKey(section.id)} />
      <div className="relative" ref={heading.setNodeRef}>
        {projectId === null ? null : (
          <RowDropDecor kind="project" refId={projectId} />
        )}
        <SectionContextMenu section={section}>
          <div
            {...heading.handle}
            data-sidebar-section-id={section.id}
            data-sidebar-project-id={section.projectId ?? undefined}
            className={cn(
              "group/header flex items-center gap-1 rounded-md px-1 py-1 transition-colors",
              !isCollapsed && "text-foreground",
            )}
          >
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              aria-label={
                isCollapsed
                  ? `Expand ${section.name}`
                  : `Collapse ${section.name}`
              }
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left"
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
                  !isCollapsed && "rotate-90",
                )}
              />
              <SectionGlyph section={section} />
              <span
                className={cn(
                  "min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider",
                  "text-muted-foreground group-hover/header:text-foreground",
                )}
              >
                {section.name}
              </span>
              {/* An empty status bucket keeps its heading but not a "0". */}
              {section.kind !== "project" && section.threadCount === 0 ? null : (
                <span className="shrink-0 text-[11px] leading-4 tabular-nums text-muted-foreground">
                  {section.threadCount}
                </span>
              )}
              {section.manual ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0">
                      <Icon
                        name="ArrowUpDown"
                        className="size-2.5 text-muted-foreground/60"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Hand-ordered — right-click to sort by most recent again
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </button>
          </div>
        </SectionContextMenu>
      </div>

      {isCollapsed ? null : section.roots.length === 0 ? (
        section.kind === "status" ? null : (
          <p className="px-3 py-1 text-xs text-muted-foreground/70">
            {section.kind === "pinned"
              ? "Drop a thread here to pin it."
              : "No threads yet."}
          </p>
        )
      ) : (
        <SortableContext items={threadIds} strategy={verticalListSortingStrategy}>
          <GroupRows
            roots={section.roots}
            sectionId={section.id}
            showProject={section.showProject}
            executions={executions}
            pullRequests={pullRequests}
            sectionLabel={section.kind === "status" ? section.name : null}
          />
        </SortableContext>
      )}
    </section>
  );
}
