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
import { SECTION_PREVIEW_SIZE } from "@/lib/section-preview";
import { useSidebar } from "./sidebar-context";
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

function RootSubtree({
  node,
  sectionId,
  showProject,
  executions,
  pullRequests,
  sectionLabel = null,
  leaving = false,
}: SubtreeProps & { leaving?: boolean }) {
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
  const content = leaving ? (
    <div aria-hidden className="bb-ws-row-leaving">
      {subtree}
    </div>
  ) : (
    subtree
  );
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

/** How long a row that left the list stays mounted, fading out in its slot. */
const ROW_EXIT_MS = 150;

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
}

/**
 * Gives a row the person just filed away a beat to fade out before the rows
 * below it close the gap.
 *
 * Marking a thread done files it in another section, so it vanishes from this
 * one the instant the edit lands. Without this the row is simply absent
 * between two frames and everything under it jumps a row height at once —
 * which reads as the sidebar glitching rather than as the thread leaving.
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
  }>({ source: roots, leaving: [] });

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
    setState({ source: roots, leaving: [...kept, ...gone] });
  }

  const { leaving } = state;
  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = setTimeout(
      () =>
        setState((prev) =>
          prev.leaving === leaving
            ? { ...prev, leaving: [] }
            : prev,
        ),
      ROW_EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);

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
  return { rows, leaving: leavingIds };
}

function GroupRows({
  section,
  roots,
  executions,
  pullRequests,
}: {
  section: Section;
  roots: readonly ThreadNode[];
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
}) {
  const sidebar = useSidebar();
  const fullRootIds = useMemo(
    () => new Set(section.roots.map(root => root.thread.id)),
    [section.roots],
  );
  // The thread is already filed by the time its row is dropped: the same
  // edit that set the status is what took it out of this group.
  const manualStatusOf = sidebar.manualStatusOf;
  const exit = useRowExit(roots, useDragActive(), (threadId) =>
    manualStatusOf(threadId) !== null && !fullRootIds.has(threadId),
  );
  return (
    <ul>
      {exit.rows.map((node) => (
        <RootSubtree
          key={node.thread.id}
          node={node}
          sectionId={section.id}
          showProject={section.showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={section.kind === "status" ? section.name : null}
          leaving={exit.leaving.has(node.thread.id)}
        />
      ))}
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
  previewRoots,
  hasLoadedMore,
  onLoadMore,
  onShowLess,
  isCollapsed,
  onToggle,
  executions,
  pullRequests,
}: {
  section: Section;
  previewRoots: readonly ThreadNode[];
  hasLoadedMore: boolean;
  onLoadMore(): void;
  onShowLess(): void;
  isCollapsed: boolean;
  onToggle(): void;
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
}) {
  const headingButtonRef = useRef<HTMLButtonElement>(null);
  const showLessButtonRef = useRef<HTMLButtonElement>(null);
  const remaining = section.roots.length - previewRoots.length;
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
      previewRoots.map((root) =>
        sortableId({
          kind: "thread",
          refId: root.thread.id,
          sectionId: section.id,
        }),
      ),
    [previewRoots, section.id],
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
              ref={headingButtonRef}
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
            section={section}
            roots={previewRoots}
            executions={executions}
            pullRequests={pullRequests}
          />
        </SortableContext>
      )}
      {!isCollapsed && (remaining > 0 || hasLoadedMore) ? (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 text-xs text-muted-foreground">
          {remaining > 0 ? (
            <button type="button" onClick={() => {
              onLoadMore();
              if (remaining <= SECTION_PREVIEW_SIZE) {
                requestAnimationFrame(() => showLessButtonRef.current?.focus({ preventScroll: true }));
              }
            }}
              aria-label={`Load ${Math.min(SECTION_PREVIEW_SIZE, remaining)} more threads in ${section.name}`}
              className="rounded px-2 py-1.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Load {Math.min(SECTION_PREVIEW_SIZE, remaining)} more <span className="text-muted-foreground/70">· {remaining} remaining</span>
            </button>
          ) : null}
          {hasLoadedMore ? (
            <button ref={showLessButtonRef} type="button" aria-label={`Show fewer threads in ${section.name}`}
              onClick={() => {
                onShowLess();
                headingButtonRef.current?.focus({ preventScroll: true });
                headingButtonRef.current?.scrollIntoView?.({ block: "nearest" });
              }}
              className="rounded px-2 py-1.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Show less
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
