// What a collapsed parent says about the threads hidden under it.
//
// A collapsed row is a promise that nothing important is hidden behind the
// chevron, so the summary answers the urgent question first: does anything
// down there need a person, is anything still running, and only then how
// many. The count alone — which is all this used to show — is the least
// actionable of the three.
//
// The glyph is the same Linear ring every row already wears and the orb is the
// same one a working row shows, so there is no second vocabulary to learn, and
// shape carries the state alongside hue exactly as StatusIcon intends.
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import type { ThreadNode } from "@/lib/resolve";
import { Icon } from "@/components/ui/icon";
import { StatusIcon } from "./StatusIcon";
import { ThreadOrb, agentOrb } from "./ThreadOrb";
import { threadStatus } from "./ThreadStatus";
import { relativeTime } from "./MetaBadges";
import { useSidebar } from "./sidebar-context";

export type SubtreeTone = "needs-you" | "working" | "unread" | "idle";

/**
 * The most urgent state anywhere below this node. These are rollups over the
 * whole subtree, not just direct children, so a great-grandchild waiting on
 * the user still lights up the root it is hidden under.
 */
export function subtreeTone(node: ThreadNode): SubtreeTone {
  if (node.hasPendingDescendant) return "needs-you";
  if (node.hasWorkingDescendant) return "working";
  if (node.hasUnreadDescendant) return "unread";
  return "idle";
}

const NOUN = (count: number) => (count === 1 ? "thread" : "threads");

export function subtreeLabel(node: ThreadNode, tone: SubtreeTone): string {
  const count = `${node.descendantCount} nested ${NOUN(node.descendantCount)}`;
  const progress =
    node.doneDescendants > 0
      ? `${count}, ${node.doneDescendants} done`
      : count;
  if (tone === "needs-you") return `${progress} · one needs you`;
  if (tone === "working") return `${progress} · working`;
  if (tone === "unread") return `${progress} · unread`;
  return progress;
}

/**
 * The chip on a collapsed parent: one glyph for the most urgent state below,
 * then the descendant count. Fixed width to about 28px, which matters — a
 * deep row has already spent its width on indent.
 */
const RING_R = 5.5;
const RING_C = 2 * Math.PI * RING_R;

/**
 * How far the subtree has got, as a ring. A batch of spawned threads is work
 * with an end, and "3 of 13 finished" is the thing a collapsed row could
 * never say while it only carried a count.
 */
function ProgressRing({
  done,
  total,
  urgent,
}: {
  done: number;
  total: number;
  urgent: boolean;
}) {
  const fraction = total === 0 ? 0 : Math.min(done / total, 1);
  return (
    <svg viewBox="0 0 14 14" aria-hidden className="size-3.5 shrink-0">
      <circle
        cx="7"
        cy="7"
        r={RING_R}
        fill="none"
        strokeWidth="2"
        className={urgent ? "stroke-[var(--ws-attention)]/25" : "stroke-muted-foreground/25"}
      />
      {fraction > 0 ? (
        <circle
          cx="7"
          cy="7"
          r={RING_R}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${RING_C * fraction} ${RING_C}`}
          transform="rotate(-90 7 7)"
          className={urgent ? "stroke-[var(--ws-attention)]" : "stroke-[var(--ws-done)]"}
        />
      ) : null}
    </svg>
  );
}

export function SubtreeSummary({ node }: { node: ThreadNode }) {
  const tone = subtreeTone(node);
  const urgent = tone === "needs-you";
  return (
    <span
      data-subtree-tone={tone}
      aria-label={subtreeLabel(node, tone)}
      className={cn(
        "flex shrink-0 items-center gap-1 text-[10px] leading-4 tabular-nums",
        urgent ? "ws-tone-attention" : "text-muted-foreground/70",
      )}
    >
      <ProgressRing
        done={node.doneDescendants}
        total={node.descendantCount}
        urgent={urgent}
      />
      {/* The orb rides alongside the ring rather than replacing it: progress
          and liveness are different questions and a batch can be both. */}
      {tone === "working" ? (
        <ThreadOrb
          orb={{ state: "working", label: "A thread below is running" }}
          className="size-2.5"
        />
      ) : null}
      {node.descendantCount}
    </span>
  );
}

/** Indent per level in the list, flattened far more tightly than the sidebar. */
const LIST_INDENT_PX = 10;

/**
 * The children behind a chevron, named. The row chip says how urgent the
 * subtree is and the count says how big; this is the only place that says
 * *which* threads they are, which is why composition belongs here rather than
 * crammed into thirty pixels of row.
 */
export function SubtreeChildList({ node }: { node: ThreadNode }) {
  // Collapsed rather than expanded ids: the card opens showing everything,
  // and folding a branch away is the exception. Local to the card on purpose
  // — this is a peek at the subtree, not a second control surface for it, so
  // folding here must not move the chevrons in the sidebar behind it.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const toggle = useCallback((threadId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  if (node.children.length === 0) return null;
  return (
    // Every descendant, never a "+N more": the card is the one place that
    // answers "which threads are under here", and a list that stops short
    // re-creates the thing collapsing already does. Long subtrees scroll.
    <ul className="flex max-h-72 min-w-0 flex-col overflow-y-auto overscroll-contain">
      {node.children.map((child) => (
        <CardRow
          key={child.thread.id}
          node={child}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}

function CardRow({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: ThreadNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (threadId: string) => void;
}) {
  const sidebar = useSidebar();
  const thread = node.thread;
  const title = thread.title ?? thread.titleFallback ?? "Untitled";
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren && !collapsed.has(thread.id);
  // Exactly what the row itself decides, so a thread reads the same in this
  // list as it does once the chevron is open in the sidebar.
  const status = threadStatus(
    thread,
    undefined,
    sidebar.manualStatusOf(thread.id),
  );
  const needsInput =
    thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
  const orb = needsInput ? null : agentOrb(thread);

  return (
    <li className="min-w-0">
      <div
        className="group/card-row flex min-w-0 items-center gap-1 rounded pr-1 hover:bg-accent/60"
        style={{ paddingLeft: `${Math.min(depth, 4) * LIST_INDENT_PX}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${isOpen ? "Collapse" : "Expand"} threads under ${title}`}
            aria-expanded={isOpen}
            onClick={() => onToggle(thread.id)}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <Icon
              name="ChevronRight"
              className={cn(
                "size-3 transition-transform duration-150",
                isOpen && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}

        {needsInput ? (
          <Icon
            name="CornerDownLeft"
            aria-hidden
            className="size-3 shrink-0 ws-tone-attention"
          />
        ) : orb !== null ? (
          <ThreadOrb orb={orb} className="size-3" />
        ) : (
          <StatusIcon tone={status?.tone ?? "idle"} className="size-3 shrink-0" />
        )}

        {/* The card is a way into these threads, not just a readout: the
            sidebar row for a deep child may be several chevrons away. */}
        <button
          type="button"
          onClick={() => sidebar.openThread(thread.id, false)}
          title={title}
          className="min-w-0 flex-1 truncate py-0.5 text-left text-xs leading-4 text-foreground"
        >
          {title}
        </button>

        {/* A thread with nothing to report falls back to when it last moved,
            exactly as its row does. Rendering nothing here was why some rows
            said "Done" and the rest said nothing at all, which reads as
            missing data rather than as "idle". */}
        {status === null ? (
          <span className="shrink-0 text-[10px] leading-4 tabular-nums text-muted-foreground/60">
            {relativeTime(thread.updatedAt)}
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 text-[10px] leading-4",
              status.tone === "needs-you" && "ws-tone-attention",
              status.tone === "working" && "ws-tone-working",
              status.tone === "problem" && "ws-tone-danger",
              status.tone !== "needs-you" &&
                status.tone !== "working" &&
                status.tone !== "problem" &&
                "text-muted-foreground/70",
            )}
          >
            {status.text}
          </span>
        )}

        {hasChildren && !isOpen ? (
          <span className="shrink-0 text-[10px] leading-4 tabular-nums text-muted-foreground/60">
            {node.descendantCount}
          </span>
        ) : null}
      </div>

      {isOpen ? (
        <ul className="min-w-0">
          {node.children.map((child) => (
            <CardRow
              key={child.thread.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
