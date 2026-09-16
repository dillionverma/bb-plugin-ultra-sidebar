import { ThreadHandoff } from "./ThreadHandoff";
import { ThreadModes } from "./ThreadModes";
import { ThreadDiffCounts, ThreadDiffsContext } from "./ThreadWorkSummary";
import { Checkbox } from "./ui/checkbox";
import { useSidebarSelection } from "./SidebarInteractions";
import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  // JSX reads a lowercase-initial name as an intrinsic element, so this one
  // has to be aliased before it can be rendered as a component.
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ThreadNode } from "@/lib/resolve";
import { MAX_RENDER_DEPTH } from "@/lib/resolve";
import type { ThreadExecution } from "@/hooks/useThreadExecution";
import { useSidebar } from "./sidebar-context";
import { StatusIcon } from "./StatusIcon";
import { ThreadOrb, agentOrb } from "./ThreadOrb";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { RowContextMenu } from "./RowContextMenu";
import { RowDropDecor, useDragActive } from "./drag-state-context";
import { ThreadDetails } from "./ThreadDetails";
import { MachineIndicator } from "./MachineIndicator";
import { ProjectIcon } from "./ProjectIcon";
import { prefetchPullRequestStack } from "./PullRequestStack";
import {
  BranchBadge,
  ModelBadge,
  PullRequestBadge,
} from "./MetaBadges";
import { ThreadStatus, threadStatus } from "./ThreadStatus";
import type { ThreadPullRequest } from "@/hooks/useThreadPullRequests";
import { STATUS_LABEL, statusBucket } from "@/lib/status";

const INDENT_PX = 14;

/**
 * Long enough that dragging across rows, or just moving the pointer to
 * something else, never triggers it.
 */
const DETAILS_OPEN_DELAY_MS = 700;

/** The one-click snooze lands at 9am tomorrow, local time. */
const SNOOZE_MORNING_HOUR = 9;

export function tomorrowMorning(now = new Date()): number {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(SNOOZE_MORNING_HOUR, 0, 0, 0);
  return next.getTime();
}

/**
 * A hover-only action in the row's trailing slot, after T3's sidebar: a
 * glyph, optionally with a word beside it. It sits inside the row's anchor,
 * so every event that would open, drag or rename the row is stopped here.
 */
function ParkButton({
  label,
  icon,
  text,
  onActivate,
}: {
  label: string;
  icon: "Clock" | "Check" | "RotateCcw";
  text?: string;
  onActivate: () => void;
}) {
  return (
    <RowTip label={label}>
      <button
        type="button"
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onActivate();
        }}
        className={cn(
          "bb-ws-row-action flex h-5 shrink-0 items-center gap-1 rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:pointer-coarse:h-9 max-md:pointer-coarse:min-w-9 max-md:pointer-coarse:justify-center",
          text === undefined ? "px-0.5" : "px-1",
        )}
      >
        <Icon name={icon} aria-hidden className="size-3.5 max-md:pointer-coarse:size-5" />
        {text === undefined ? null : (
          <span className="text-[11px] font-medium">{text}</span>
        )}
      </button>
    </RowTip>
  );
}

/**
 * The small tooltip directly above a glyph in the row. The native `title`
 * attribute is too slow to feel attached to the thing under the pointer, and
 * a `?` or a tick without a word is a guess.
 */
function RowTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RowHover({
  enabled,
  details,
  onWarm,
  children,
}: {
  enabled: boolean;
  details: ReactNode;
  /**
   * Called as the pointer arrives, before the open delay has run. The card's
   * slow facts (the pull request stack) start loading here, so the delay is
   * spent fetching rather than adding to the wait once the card is open.
   */
  onWarm?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  return (
    <HoverCard
      open={enabled && open}
      onOpenChange={setOpen}
      openDelay={DETAILS_OPEN_DELAY_MS}
      closeDelay={180}
    >
      <HoverCardTrigger asChild>
        <span
          className="flex w-full flex-col gap-0.5"
          onPointerEnter={(event) => {
            // A touch never opens the card, so it has nothing to warm.
            if (enabled && event.pointerType !== "touch") onWarm?.();
          }}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} collisionPadding={12}
        className="w-auto max-w-[calc(100vw-1.5rem)] p-3"
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.stopPropagation()}>

        {details}
      </HoverCardContent>
    </HoverCard>
  );
}

export const ThreadRow = memo(function ThreadRow({
  node,
  workspaceId,
  showProject,
  execution,
  pullRequest,
  sectionLabel = null,
  dragHandle,
}: {
  node: ThreadNode;
  workspaceId: string | null;
  /** False under a project heading, where the badge would only repeat it. */
  showProject: boolean;
  execution: ThreadExecution | undefined;
  pullRequest: ThreadPullRequest | undefined;
  /** The status heading above the row, when there is one. */
  sectionLabel?: string | null;
  /** dnd-kit's press listeners, from the sortable wrapper; roots only. */
  dragHandle?: DraggableSyntheticListeners;
}) {
  const sidebar = useSidebar();
  const selection = useSidebarSelection();
  const { thread } = node;
  const manualStatus = sidebar.manualStatusOf(thread.id);
  const bucket = statusBucket(manualStatus, pullRequest);
  const diff = useContext(ThreadDiffsContext).get(thread.id);
  const diffCounts = diff && (diff.additions > 0 || diff.deletions > 0)
    ? <ThreadDiffCounts threadId={thread.id} /> : null;
  const isActive = sidebar.activeThreadId === thread.id;
  const isRoot = node.depth === 0;
  const isExpanded = sidebar.isSubtreeExpanded(thread.id);
  const descendantCount = node.descendantCount;
  const hasChildren = node.children.length > 0;

  const compact = sidebar.compactRows;
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [modeDetailsOpen, setModeDetailsOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // bb owns the drag-out-to-split gesture. It listens on pointerdown, our
  // sortable handle on mousedown, so both see the press; the sensor's
  // sideways tolerance is what keeps a split drag from also being a reorder.
  const split = experimental_useSidebarThreadSplit(thread.id);

  // A hover card opening under a drag would sit over the drop target.
  const isDragActive = useDragActive();

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        setDraftTitle(thread.title ?? thread.titleFallback ?? "Untitled");
        return;
      }
      if (!event.altKey || !isRoot) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      sidebar.nudge(
        { kind: "thread", refId: thread.id },
        event.key === "ArrowUp" ? -1 : 1,
      );
    },
    [isRoot, sidebar, thread.id],
  );

  const commitRename = useCallback(() => {
    const next = draftTitle?.trim() ?? "";
    setDraftTitle(null);
    if (next !== "" && next !== thread.title) {
      sidebar.renameThread(thread.id, next);
    }
  }, [draftTitle, sidebar, thread.id, thread.title]);

  // Focus on the next frame, not during the commit that closes the context
  // menu — autoFocus there loses the race with Radix restoring focus to the
  // trigger, which blurs the field straight back out of edit mode.
  const isRenaming = draftTitle !== null;
  useEffect(() => {
    if (isRenaming || isDragActive) setDetailsOpen(false);
  }, [isRenaming, isDragActive]);
  useEffect(() => {
    if (!isRenaming) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isRenaming]);

  const title = thread.title ?? thread.titleFallback ?? "Untitled";
  const indent = Math.min(node.depth, MAX_RENDER_DEPTH) * INDENT_PX;
  const provider = sidebar.provider(thread.providerId);
  const status = threadStatus(thread, pullRequest, manualStatus);
  const needsInput = thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
  const orb = needsInput ? null : agentOrb(thread);

  // Each badge is behind its own switch in View options; a switched-off fact
  // is simply absent, and a row with nothing left has no second line.
  const details = sidebar.rowDetails;
  // From the thread, not the section: a status bucket's group is named after
  // the bucket, not a project.
  const projectName = sidebar.projectNameOf(thread.projectId);
  const project =
    details.project && (compact || showProject) && projectName !== "" ? projectName : null;
  const branch = details.branch
    ? (thread.environment?.branchName ?? null)
    : null;
  const machine = details.machine ? (thread.host?.name ?? null) : null;
  const model = details.model ? (execution?.model ?? null) : null;
  const pr = details.pullRequest ? pullRequest : undefined;
  // An unregistered provider still gets its icon, drawn from the id alone.
  const agent = details.agent ? (provider ?? { id: thread.providerId }) : null;
  // The checkout behind the folder and branch badges, once the server has
  // said where it is. Until then the badges are plain text.
  const environmentId = thread.environment?.id ?? null;
  const folder =
    environmentId === null ? null : sidebar.locationOf(environmentId);
  const openFolder = useCallback(() => {
    if (environmentId !== null) sidebar.openFolder(environmentId);
  }, [sidebar, environmentId]);
  const hasMeta =
    branch !== null ||
    model !== null ||
    pr !== undefined;

  const needsAttention =
    status?.tone === "needs-you" || status?.tone === "problem";
  // The turn itself ended in an error (not a PR problem): bb can re-run it.
  const failed = thread.indicator === "unread-error";
  const showRowStatus =
    status !== null && status.tone !== "idle" && status.tone !== "done" &&
    status.text !== STATUS_LABEL[bucket] &&
    thread.indicator !== "goal" && thread.indicator !== "plan-mode";
  const threadDetails = (
    <ThreadDetails
      thread={thread}
      projectName={projectName}
      provider={provider}
      execution={execution}
      pullRequest={pullRequest}
      manualStatus={manualStatus}
      descendantCount={descendantCount}
    />
  );
  // Touch has no hover, so coarse pointers keep the actions in view. A phone
  // sidebar is narrow enough that the cluster would cover every title, so
  // there only the active thread keeps it; every row still has the
  // long-press menu.
  const rowActions = isRenaming || selection.active ? null : (
    <span
      data-thread-row-actions=""
      className={compact
        ? cn(
            "absolute right-0 flex items-center gap-0.5 rounded bg-accent transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 md:pointer-coarse:pointer-events-auto md:pointer-coarse:opacity-100",
            isActive && "max-md:pointer-coarse:pointer-events-auto max-md:pointer-coarse:opacity-100",
            handoffOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )
        : cn(
            "shrink-0 items-center gap-0.5 group-hover/row:flex group-focus-within/row:flex md:pointer-coarse:flex",
            isActive && "max-md:pointer-coarse:flex",
            handoffOpen ? "flex" : "hidden",
          )}
    >
      <ThreadHandoff threadId={thread.id} workspaceId={workspaceId} sourceProviderId={thread.providerId} currentModel={execution?.model ?? null} onOpenChange={setHandoffOpen} />
      {failed ? (
        <ParkButton
          label="Retry the failed turn"
          icon="RotateCcw"
          text={compact ? undefined : "Retry"}
          onActivate={() => sidebar.retryThread(thread.id)}
        />
      ) : null}
      {bucket === "in-progress" || bucket === "in-review" ? (
        <>
          <ParkButton
            label="Hide until tomorrow at 9am"
            icon="Clock"
            onActivate={() => sidebar.setSnoozed(thread.id, tomorrowMorning())}
          />
          <ParkButton
            label="Mark done"
            icon="Check"
            text={compact ? undefined : "Done"}
            onActivate={() => sidebar.setStatus(thread.id, "done")}
          />
        </>
      ) : null}
    </span>
  );

  return (
    <div
      className="relative group/selection-row flex items-start"
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: compact ? "32px" : "44px",
      }}
    >
      {isRoot ? <RowDropDecor kind="thread" refId={thread.id} /> : null}
      {draftTitle === null && selection.active && (
        <span className="bb-ws-checkbox-gutter flex w-[26px] shrink-0 justify-center pt-2"
          onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}>
          <Checkbox aria-label={`Select ${title}`} checked={selection.selected.has(thread.id)}
            onClick={event => { event.stopPropagation(); selection.toggle(thread.id, event.shiftKey); }} />
        </span>
      )}

      <RowContextMenu
        item={{ kind: "thread", refId: thread.id }}
        currentWorkspaceId={workspaceId}
        thread={thread}
        manualStatus={manualStatus}
        pullRequestUrl={pullRequest?.url ?? null}
        onRename={() => setDraftTitle(title)}
      >
        {/* Both data-sidebar-* attributes are a host contract: bb's thread
            shortcuts find rows by query selector, not by React state. */}
        <a
          href="#"
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          data-sidebar-bucket={bucket}
          data-thread-layout={compact ? "compact" : "detailed"}
          data-attention={needsAttention}
          data-selected={selection.selected.has(thread.id)}
          aria-current={isActive ? "page" : undefined}
          aria-keyshortcuts={isRoot ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          draggable={false}
          onPointerDown={(event) => {
            if (!selection.active && !event.metaKey && !event.ctrlKey && !event.shiftKey)
              split.splitProps.onPointerDown?.(event);
          }}
          {...(selection.active ? {} : dragHandle)}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            event.preventDefault();
            if (draftTitle !== null) return;
            if (selection.click(thread.id, event)) return;
            sidebar.openThread(thread.id, false);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            if (!selection.active) setDraftTitle(title);
          }}
          className={cn(
            "bb-ws-row group/row flex min-w-0 flex-1 flex-col gap-0.5 rounded-md py-1 pr-2 text-sm transition-colors",
            "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            isActive && "bg-accent text-foreground",
            split.layout !== null && !isActive && "bg-accent/30",
          )}
          style={{ paddingLeft: `${6 + indent}px` }}
        >
          <RowHover
            enabled={draftTitle === null && !isDragActive && !detailsOpen && !handoffOpen && !modeDetailsOpen && !selection.active}
            onWarm={() => prefetchPullRequestStack(thread.id)}
            details={threadDetails}
          >
            {/* Reserve the hover buttons' height even while the status is shown. */}
            <span
              className={cn(
                "bb-ws-mainline relative flex w-full items-center gap-1.5",
                compact ? "min-h-6" : "min-h-5",
              )}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={
                    isExpanded ? "Collapse subagents" : "Expand subagents"
                  }
                  aria-expanded={isExpanded}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    sidebar.toggleSubtree(thread.id);
                  }}
                  className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon
                    name="ChevronRight"
                    className={cn(
                      "size-3 transition-transform duration-150",
                      isExpanded && "rotate-90",
                    )}
                  />
                </button>
              ) : (
                <span aria-hidden className="w-4 shrink-0" />
              )}

              <span className="flex shrink-0 items-center">
                {needsInput ? (
                  <RowTip label="Waiting for your input">
                    <span className="flex shrink-0 items-center ws-tone-attention">
                      <Icon name="CornerDownLeft" aria-hidden className="size-3.5 shrink-0" />
                    </span>
                  </RowTip>
                ) : orb !== null ? (
                  <RowTip label={orb.label}>
                    <span className="flex shrink-0 items-center">
                      <ThreadOrb orb={orb} />
                    </span>
                  </RowTip>
                ) : (
                  <RowTip
                    label={
                      status?.detail ??
                      thread.indicatorLabel ??
                      "Nothing to report"
                    }
                  >
                    <span className="flex shrink-0 items-center">
                      <StatusIcon
                        tone={status?.tone ?? "idle"}
                        label={
                          status?.detail ?? thread.indicatorLabel ?? undefined
                        }
                        className="size-3.5 shrink-0"
                      />
                    </span>
                  </RowTip>
                )}
              </span>
              <span className="relative flex min-w-0 flex-1 items-center">
                {draftTitle === null ? (
                  orb !== null ? (
                    <TextShimmer
                      className="bb-ws-title min-w-0 flex-1 truncate font-medium"
                      duration={2}
                    >
                      {title}
                    </TextShimmer>
                  ) : (
                    <span
                      className={cn(
                        "bb-ws-title min-w-0 flex-1 truncate",
                        // The title is the thing being scanned for; everything else
                        // on the row is support.
                        isActive || thread.isUnread
                          ? "font-medium text-foreground"
                          : "text-foreground/90",
                      )}
                    >
                      {title}
                    </span>
                  )
                ) : (
                  <input
                    ref={inputRef}
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={commitRename}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") setDraftTitle(null);
                    }}
                    aria-label="Rename thread"
                    className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm text-foreground outline-none ring-1 ring-border"
                  />
                )}

                {/* Hover actions leave the device, subagent count, and status in place. */}
                {compact ? rowActions : null}
              </span>

              {needsInput ? (
                <RowTip label={thread.indicatorLabel ?? "Waiting on an approval or an answer"}>
                  <span className="bb-ws-your-turn inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold leading-4">
                    Your turn
                  </span>
                </RowTip>
              ) : null}

              {thread.isPinned ? (
                <RowTip label="Pinned">
                  <span className="flex shrink-0 items-center">
                    <Icon
                      name="Pin"
                      aria-label="Pinned"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  </span>
                </RowTip>
              ) : null}

              {/* Roll a collapsed subtree's state up, so a waiting subagent is
                never silently hidden behind a chevron. */}
              {hasChildren && !isExpanded ? (
                <RowTip
                  label={
                    `${descendantCount} ${descendantCount === 1 ? "subagent" : "subagents"}` +
                    (node.hasPendingDescendant
                      ? " · one needs you"
                      : node.hasUnreadDescendant
                        ? " · unread"
                        : "")
                  }
                >
                  <span
                    aria-label={`${descendantCount} subagents`}
                    className={cn(
                      "shrink-0 rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
                      node.hasPendingDescendant
                        ? "bg-primary/20 text-foreground"
                        : node.hasUnreadDescendant
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {descendantCount}
                  </span>
                </RowTip>
              ) : null}

              {compact ? null : rowActions}
            </span>

            {draftTitle === null ? (
              <ThreadModes
                thread={thread}
                compact={compact}
                details={threadDetails}
                onDetailsOpenChange={setModeDetailsOpen}
                trailing={diffCounts}
              >
                <span className="inline-flex min-w-0 max-w-full items-center gap-1" data-thread-context="">
                  {agent === null ? null : (
                    <RowTip label={[provider?.displayName ?? thread.providerId, execution?.model].filter(Boolean).join(" · ")}>
                      <span className="flex shrink-0 items-center text-muted-foreground" data-thread-provider-logo="">
                        <ProviderIcon providerKind="agent" provider={agent} className="size-3 shrink-0 opacity-80" />
                      </span>
                    </RowTip>
                  )}
                  {project === null ? null : (
                    <RowTip label={`Project · ${project}`}>
                      <span data-thread-project="" className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                        <ProjectIcon projectId={thread.projectId} className="size-3" />
                        <span className="min-w-0 truncate">{project}</span>
                      </span>
                    </RowTip>
                  )}
                  <MachineIndicator
                    name={machine}
                    threadTitle={title}
                    open={detailsOpen}
                    onOpenChange={setDetailsOpen}
                    onWarm={() => prefetchPullRequestStack(thread.id)}
                  >
                    {threadDetails}
                  </MachineIndicator>
                </span>
                {!needsInput && (needsAttention || showRowStatus) ? (
                  <span className="min-w-0 max-w-full">
                    <ThreadStatus status={status} updatedAt={thread.updatedAt} sectionLabel={sectionLabel} />
                  </span>
                ) : null}
              </ThreadModes>
            ) : null}

            {!compact && hasMeta && draftTitle === null ? (
            <span
              className="flex w-full items-center gap-2 overflow-hidden"
              style={{ paddingLeft: "22px" }}
            >
              {branch === null ? null : (
                <BranchBadge
                  branch={branch}
                  folder={folder}
                  onOpenFolder={openFolder}
                />
              )}
              {model === null ? null : <ModelBadge model={model} />}
              {pr === undefined ? null : (
                <PullRequestBadge
                  pullRequest={pr}
                  onOpen={() => sidebar.openUrl(pr.url)}
                />
              )}
            </span>
            ) : null}
          </RowHover>
        </a>
      </RowContextMenu>
    </div>
  );
});
