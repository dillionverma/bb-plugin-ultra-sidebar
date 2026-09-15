// What a row says about itself, in one word.
//
// A thread can be several things at once: waiting on you AND having a PR with
// failing checks AND running a background agent. Showing all of that is how a
// sidebar becomes noise, so this resolves to exactly one status by rank, and
// the rank is the point: the states that need a human come first, then the
// ones that are merely in motion, then the ones that are finished.
//
// A timestamp is the fallback — what you show when there is nothing to say.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ThreadPullRequest } from "@/hooks/useThreadPullRequests";
import type { ManualStatus } from "@/lib/status";
import { relativeTime } from "./MetaBadges";

/**
 * Six families, so a glance at colour alone is meaningful even before the
 * word is read.
 */
export type StatusTone =
  | "needs-you" // blocked on the person reading this
  | "problem" // something failed or is stuck
  | "review" // an open pull request is waiting for the person to look
  | "working" // in motion, nothing required
  | "done" // finished, merged, settled
  | "idle"; // nothing to report

export interface Status {
  text: string;
  tone: StatusTone;
  /** Longer phrasing for the detail card and screen readers. */
  detail: string;
}

export const TONE_TEXT: Record<StatusTone, string> = {
  "needs-you": "ws-tone-attention",
  problem: "ws-tone-danger",
  review: "ws-tone-success",
  working: "ws-tone-working",
  done: "ws-tone-done",
  idle: "text-muted-foreground",
};

// bb adds indicator kinds over time; anything unknown falls through to the
// pull request, then to the timestamp.
const BY_INDICATOR: Record<string, Status> = {
  "waiting-for-input": {
    text: "Your turn",
    tone: "needs-you",
    detail: "Waiting for your input",
  },
  "unread-error": { text: "Failed", tone: "problem", detail: "Ended in an error" },
  runtime: { text: "Working", tone: "working", detail: "The agent is running" },
  "background-agent": {
    text: "Working",
    tone: "working",
    detail: "A background agent is running",
  },
  "background-command": {
    text: "Running",
    tone: "working",
    detail: "A background command is running",
  },
  workflow: {
    text: "Workflow",
    tone: "working",
    detail: "A workflow is running",
  },
  "plan-mode": { text: "Planning", tone: "working", detail: "In plan mode" },
  goal: { text: "Goal", tone: "working", detail: "Working toward a goal" },
  "unread-success": {
    text: "Done",
    tone: "done",
    detail: "Finished since you last looked",
  },
  "working-draft": { text: "Draft", tone: "idle", detail: "An unsent draft" },
  draft: { text: "Draft", tone: "idle", detail: "An unsent draft" },
};

// Pull-request states by what they ask of the person. The "problem" and
// "needs-you" ones interrupt a running thread; the "review" ones mean the
// agent has handed the work over and the next move is the reader's, so they
// only surface once the thread itself has gone quiet.
const BY_PR_ATTENTION: Record<string, Status> = {
  conflicts: {
    text: "Conflicts",
    tone: "problem",
    detail: "The pull request has merge conflicts",
  },
  checks_failed: {
    text: "Checks failed",
    tone: "problem",
    detail: "Pull request checks are failing",
  },
  changes_requested: {
    text: "Changes",
    tone: "needs-you",
    detail: "Changes requested on the pull request",
  },
  blocked: {
    text: "Blocked",
    tone: "problem",
    detail: "The pull request is blocked from merging",
  },
  review_requested: {
    text: "In review",
    tone: "review",
    detail: "The pull request is waiting for your review",
  },
  checks_pending: {
    text: "Checks",
    tone: "review",
    detail: "The pull request is open and its checks are running",
  },
  ready_to_merge: {
    text: "Ready",
    tone: "review",
    detail: "The pull request is ready for you to merge",
  },
};

/** An open, non-draft PR with nothing more specific to say about it. */
const OPEN_PR: Status = {
  text: "In review",
  tone: "review",
  detail: "The pull request is open and waiting on you",
};

const BY_PR_STATE: Record<string, Status> = {
  merged: { text: "Merged", tone: "done", detail: "The pull request is merged" },
  closed: {
    text: "Closed",
    tone: "idle",
    detail: "The pull request was closed without merging",
  },
  draft: { text: "PR draft", tone: "idle", detail: "The pull request is a draft" },
};

/** The word for a bucket the person chose by hand. */
const BY_MANUAL: Record<ManualStatus, Status> = {
  done: { text: "Done", tone: "done", detail: "Marked done by you" },
  backlog: { text: "Backlog", tone: "idle", detail: "Filed in the backlog" },
  canceled: { text: "Canceled", tone: "idle", detail: "Canceled by you" },
};

export function threadStatus(
  thread: PluginSidebarThread,
  pullRequest?: ThreadPullRequest,
  manualStatus: ManualStatus | null = null,
): Status | null {
  // 1. Blocked on a person. Outranks everything — it is the only state where
  //    nothing moves until the user acts.
  if (thread.hasPendingInteraction) {
    return {
      text: "Your turn",
      tone: "needs-you",
      detail: "Waiting on an approval or an answer",
    };
  }

  const indicator = BY_INDICATOR[thread.indicator];

  // 2. A failure outranks a merged PR: the newer fact is the useful one.
  if (indicator?.tone === "problem") return indicator;

  // 3. A pull request that needs attention outranks the thread simply running,
  //    because the agent finishing will not resolve it.
  if (pullRequest !== undefined) {
    const blocking = BY_PR_ATTENTION[pullRequest.attention];
    if (blocking?.tone === "problem" || blocking?.tone === "needs-you") {
      return blocking;
    }
  }

  // 4. In motion.
  if (indicator?.tone === "working") return indicator;

  // 5. Terminal pull-request states, then an open PR waiting on the reader:
  //    the agent opened it and stopped, so reviewing it is the next move.
  if (pullRequest !== undefined) {
    const byState = BY_PR_STATE[pullRequest.state];
    if (byState !== undefined) return byState;
    const review = BY_PR_ATTENTION[pullRequest.attention];
    if (review !== undefined) return review;
    if (pullRequest.state === "open") return OPEN_PR;
  }

  // 6. A hand-filed status is a decision about the work, not a report from
  //    it, so it yields to anything the thread or its PR actually says.
  if (manualStatus !== null) return BY_MANUAL[manualStatus];

  return indicator ?? null;
}

export function ThreadStatus({
  status,
  updatedAt,
  sectionLabel = null,
}: {
  status: Status | null;
  updatedAt: number;
  /**
   * The heading above the row. When it already says what the row would say
   * ("Done" under Done), repeating it is noise; the timestamp goes there
   * instead. Anything more specific ("Working" under In review) still shows.
   */
  sectionLabel?: string | null;
}) {
  if (status === null || status.text === sectionLabel) {
    return (
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
        {relativeTime(updatedAt)}
      </span>
    );
  }
  const text = (
    <span className={cn("shrink-0 text-[11px] font-medium", TONE_TEXT[status.tone])}>
      {status.text}
    </span>
  );
  if (status.detail === status.text) return text;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {status.detail}
      </TooltipContent>
    </Tooltip>
  );
}
