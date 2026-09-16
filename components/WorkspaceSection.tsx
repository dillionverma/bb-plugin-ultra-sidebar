import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MAX_RENDER_DEPTH } from "@/lib/resolve";
import type { ProjectGroup, Section, ThreadNode } from "@/lib/resolve";
import type { ExecutionMap } from "@/hooks/useThreadExecution";
import type { PullRequestMap } from "@/hooks/useThreadPullRequests";
import { guardHandle } from "@/hooks/useSidebarDnd";
import { sectionKey, sortableId, type DndData, type DropZone } from "@/lib/dnd";
import { isSyntheticSectionId } from "@/lib/regroup";
import { containsThread } from "@/lib/contains-thread";
import { revealRow } from "@/lib/reveal-row";
import { useSidebar } from "./sidebar-context";
import { useWindowedRows } from "./scroll-container";
import { ThreadRow } from "./ThreadRow";
import { ProjectIcon } from "./ProjectIcon";
import { ProjectContextMenu, WorkspaceContextMenu } from "./RowContextMenu";
import { RowDropDecor, SectionDropDecor } from "./drag-state-context";
import { StatusIcon } from "./StatusIcon";
import { bucketFromSectionId } from "@/lib/status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Rows keep sliding into place when the list changes under them — a thread
 * bumps to the top, a settle removes one — not only while a drag is on.
 * dnd-kit's default animates layout changes only mid-sort; this is its
 * documented way of saying "always".
 */
const animateAlways: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true });

/**
 * One dnd-kit node: a row or section that can be picked up, landed on, or
 * both. A node that is neither still registers, so its rows keep their
 * sortable context, but dnd-kit ignores it.
 */
function useSortableZone(
  kind: DropZone["kind"],
  refId: string | null,
  workspaceId: string | null,
  { draggable, droppable = true }: { draggable: boolean; droppable?: boolean },
) {
  const data = useMemo<DndData>(
    () => ({ zone: { kind, refId, workspaceId }, draggable }),
    [kind, refId, workspaceId, draggable],
  );
  const sortable = useSortable({
    id: sortableId(data.zone),
    data,
    disabled: { draggable: !draggable, droppable: !droppable },
    animateLayoutChanges: animateAlways,
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
  workspaceId: string | null;
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
  workspaceId,
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
          "--ws-tree-left": `${14 + Math.min(node.depth, MAX_RENDER_DEPTH) * 14}px`,
        } as React.CSSProperties
      }
    >
      {node.children.map((child) => (
        <ChildSubtree
          key={child.thread.id}
          node={child}
          workspaceId={workspaceId}
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
  workspaceId,
  showProject,
  executions,
  pullRequests,
  sectionLabel = null,
  virtual,
}: SubtreeProps & { virtual?: VirtualSlot }) {
  const sidebar = useSidebar();
  const expanded = sidebar.isSubtreeExpanded(node.thread.id);
  const { setNodeRef, style, handle, isDragging } = useSortableZone(
    "thread",
    node.thread.id,
    workspaceId,
    { draggable: true },
  );
  const content = (
    <>
      <ThreadRow
        node={node}
        workspaceId={workspaceId}
        showProject={showProject}
        // Passed as a prop rather than read from context so the memo on
        // ThreadRow still bails out for rows whose metadata did not change.
        execution={executions.get(node.thread.id)}
        sectionLabel={sectionLabel}
        pullRequest={pullRequests.get(node.thread.id)}
        dragHandle={handle}
      />
      {expanded ? (
        <SubtreeChildren
          node={node}
          workspaceId={workspaceId}
          showProject={showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={sectionLabel}
        />
      ) : null}
    </>
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

/**
 * A group's root rows, windowed: only the rows near the viewport are in the
 * DOM, the list reserves the height of the rest. Without a scroll area to
 * window against (jsdom, an unexpected host) every row renders in flow.
 */
function GroupRows({
  group,
  workspaceId,
  showProject,
  executions,
  pullRequests,
  sectionLabel,
  className,
}: {
  group: ProjectGroup;
  workspaceId: string | null;
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
  const windowed = useWindowedRows(group.roots, {
    keyOf: (node) => node.thread.id,
    estimateSize: () => estimate,
  });
  // Bring the thread the user is looking at into view when it changed from
  // somewhere other than a click on its row: Mod+[ / Mod+], the palette, a
  // link. A row already on screen is left where it is.
  const revealRef = useRef({ roots: group.roots, windowed });
  revealRef.current = { roots: group.roots, windowed };
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
  }, [activeThreadId]);
  if (!windowed.active) {
    return (
      <ul ref={windowed.listRef} className={className}>
        {group.roots.map((node) => (
          <RootSubtree
            key={node.thread.id}
            node={node}
            workspaceId={workspaceId}
            showProject={showProject}
            executions={executions}
            pullRequests={pullRequests}
            sectionLabel={sectionLabel}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul
      ref={windowed.listRef}
      className={cn("relative", className)}
      style={{ height: windowed.totalSize }}
    >
      {windowed.items.map((item) => {
        const node = windowed.rowAt(item);
        return (
          <RootSubtree
            key={node.thread.id}
            node={node}
            workspaceId={workspaceId}
            showProject={showProject}
            executions={executions}
            pullRequests={pullRequests}
            sectionLabel={sectionLabel}
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
  workspaceId,
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
        workspaceId={workspaceId}
        showProject={showProject}
        execution={executions.get(node.thread.id)}
        sectionLabel={sectionLabel}
        pullRequest={pullRequests.get(node.thread.id)}
      />
      {expanded ? (
        <SubtreeChildren
          node={node}
          workspaceId={workspaceId}
          showProject={showProject}
          executions={executions}
          pullRequests={pullRequests}
          sectionLabel={sectionLabel}
        />
      ) : null}
    </li>
  );
}

const ProjectGroupView = memo(function ProjectGroupView({
  group,
  workspaceId,
  executions,
  pullRequests,
  flat = false,
  sectionLabel = null,
}: {
  group: ProjectGroup;
  workspaceId: string | null;
  executions: ExecutionMap;
  pullRequests: PullRequestMap;
  /** The section is already the grouping; skip the project heading. */
  flat?: boolean;
  /** The status heading, when the section is a status bucket. */
  sectionLabel?: string | null;
}) {
  const sidebar = useSidebar();
  const isCollapsed = !flat && sidebar.isProjectCollapsed(workspaceId, group.projectId);

  // A foreign group is a view of threads borrowed from another workspace, not
  // this workspace's project — dragging it would imply an ownership this
  // section does not have. A flat group has no heading to pick up at all.
  const { setNodeRef, style, handle, isDragging } = useSortableZone(
    "project",
    group.projectId,
    workspaceId,
    { draggable: !flat && !group.isForeign, droppable: !flat },
  );
  const threadIds = useMemo(
    () =>
      group.roots.map((root) =>
        sortableId({ kind: "thread", refId: root.thread.id, workspaceId }),
      ),
    [group.roots, workspaceId],
  );

  const rows = (
    <SortableContext items={threadIds} strategy={verticalListSortingStrategy}>
      <GroupRows
        group={group}
        workspaceId={workspaceId}
        // No heading above a flat group: the row names its project.
        showProject={flat}
        executions={executions}
        pullRequests={pullRequests}
        sectionLabel={sectionLabel}
        className={flat ? undefined : "bb-ws-project-threads"}
      />
    </SortableContext>
  );

  if (flat) return <li className="relative">{rows}</li>;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("relative", isDragging && "z-10 opacity-60")}
    >
      <RowDropDecor kind="project" refId={group.projectId} />
      <ProjectContextMenu
        projectId={group.projectId}
        currentWorkspaceId={workspaceId}
      >
        <div
          data-sidebar-project-id={group.projectId}
          {...handle}
          className="group/project flex items-center gap-1 rounded-md px-1 py-1"
        >
          <button
            type="button"
            onClick={() => sidebar.toggleProject(workspaceId, group.projectId)}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Expand ${group.name}`
                : `Collapse ${group.name}`
            }
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded text-left text-xs font-medium",
              group.isForeign
                ? "text-muted-foreground/70"
                : "text-muted-foreground",
              "hover:text-foreground",
            )}
          >
            <Icon
              name="ChevronRight"
              className={cn(
                "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150",
                !isCollapsed && "rotate-90",
              )}
            />
            <ProjectIcon
              projectId={group.projectId}
              isPersonal={group.isPersonal}
              className="size-3.5 opacity-80"
            />
            <span className="min-w-0 truncate">
              {group.isForeign ? `from ${group.name}` : group.name}
            </span>
            {isCollapsed && group.threadCount > 0 ? (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                {group.threadCount}
              </span>
            ) : null}
          </button>
        </div>
      </ProjectContextMenu>

      {group.roots.length > 0 && !isCollapsed ? rows : null}
    </li>
  );
});

export function WorkspaceSection({
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
  const sidebar = useSidebar();
  const [draftName, setDraftName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isUnassigned = section.workspaceId === null;
  // A status section names its own glyph; anything else has none.
  const sectionBucket = bucketFromSectionId(section.workspaceId);

  // Unassigned and the status buckets have no order of their own: they can
  // be landed on, never picked up.
  const { setNodeRef, style, handle, isDragging } = useSortableZone(
    "workspace",
    section.workspaceId,
    section.workspaceId,
    { draggable: !isUnassigned && !isSyntheticSectionId(section.workspaceId) },
  );
  const projectIds = useMemo(
    () =>
      section.groups.map((group) =>
        sortableId({
          kind: "project",
          refId: group.projectId,
          workspaceId: section.workspaceId,
        }),
      ),
    [section.groups, section.workspaceId],
  );

  const startRename = () => setDraftName(section.name);

  // Focus on the next frame, not during the commit that closes the context
  // menu — autoFocus at that moment loses the race with Radix restoring focus
  // to the trigger, which blurs the input straight back out of edit mode.
  const isRenaming = draftName !== null;
  useEffect(() => {
    if (!isRenaming) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isRenaming]);

  const commitRename = () => {
    const next = draftName?.trim() ?? "";
    setDraftName(null);
    if (section.workspaceId !== null && next !== "" && next !== section.name) {
      sidebar.renameWorkspace(section.workspaceId, next);
    }
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn("relative mb-1", isDragging && "z-10 opacity-60")}
    >
      <SectionDropDecor sectionKey={sectionKey(section.workspaceId)} />
      <div className="relative">
        <WorkspaceContextMenu
          workspaceId={section.workspaceId}
          sortMode={section.sortMode}
          onRename={startRename}
        >
          <div
            {...handle}
            className={cn(
              "group/header flex items-center gap-1 rounded-md px-1 py-1 transition-colors",
              !isCollapsed && "text-foreground",
            )}
          >
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left"
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
                  !isCollapsed && "rotate-90",
                )}
              />
              {sectionBucket === null ? null : (
                <StatusIcon tone={sectionBucket} className="size-3.5 shrink-0" />
              )}
              {draftName === null ? (
                <span
                  className={cn(
                    "min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider",
                    "text-muted-foreground group-hover/header:text-foreground",
                  )}
                >
                  {section.name}
                </span>
              ) : (
                <input
                  ref={inputRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") setDraftName(null);
                  }}
                  aria-label="Rename workspace"
                  className="min-w-0 flex-1 rounded-sm bg-background px-1 text-xs text-foreground outline-none ring-1 ring-border"
                />
              )}
              {/* An empty status bucket keeps its heading but not a "0". */}
              {sectionBucket !== null && section.threadCount === 0 ? null : (
                <span className="shrink-0 text-[11px] leading-4 tabular-nums text-muted-foreground">
                  {section.threadCount}
                </span>
              )}
              {section.sortMode === "manual" ? (
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
                    Manual order — new threads do not jump to the top
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </button>
          </div>
        </WorkspaceContextMenu>
      </div>

      {isCollapsed ? null : section.groups.length === 0 ? (
        sectionBucket !== null ? null : (
          <p className="px-3 py-1 text-xs text-muted-foreground/70">
            {section.flat ? "No threads yet." : isUnassigned
              ? "Everything is filed."
              : "Drop a project or thread here."}
          </p>
        )
      ) : (
        <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
          <ul className="bb-ws-section-tree">
            {section.groups.map((group) => (
              <ProjectGroupView
                flat={section.flat === true}
                sectionLabel={sectionBucket === null ? null : section.name}
                key={`${group.projectId}:${group.isForeign ? "foreign" : "owned"}`}
                group={group}
                workspaceId={section.workspaceId}
                executions={executions}
                pullRequests={pullRequests}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </section>
  );
}
