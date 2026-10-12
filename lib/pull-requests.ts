// A thread's pull request, and how to keep hold of it.
//
// bb answers "what pull request does this thread have?" from the thread's
// *environment*: it asks the checkout what branch it is on, then asks the git
// host what pull request that branch has. That is the official surface and the
// right first answer — but it only holds while the checkout does. Review
// environments are meant to be thrown away, so a thread routinely outlives the
// only thing that can name its pull request, and the row falls back to In
// progress: a lie about work that was merged days ago.
//
// So we hold on to the one fact that never changes. A pull request's number is
// immutable: it survives a deleted worktree, a pruned head branch and a squash
// merge, all of which destroy the branch name the environment lookup depends
// on. Bind the number to the thread once and the state can always be read back.
//
// bb's own builtin github plugin settled on the same shape — pullForThread
// asks the environment first and falls back to a durable link it keeps itself.
//
// Free of node imports: the reader that spawns `gh` lives next door in
// pull-requests.server.ts, and everything here is pure so it can be tested
// without one.

/** The four states bb models, and the sidebar buckets from. */
export type PullRequestState = "open" | "draft" | "merged" | "closed";

/** Enough to ask the git host about a pull request, and nothing more. */
export interface PullRequestRef {
  repo: string;
  number: number;
}

/**
 * The slice of a pull request the sidebar draws: a bucket, a label, and the
 * one badge worth a row's width. Deliberately the same shape the environment
 * lookup is narrowed to, so a snapshot read back from the store and one just
 * fetched are indistinguishable downstream.
 */
export interface PullRequestSnapshot {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  attention: string;
  checksState: string | null;
  failedChecks: number;
}

/**
 * Whether a pull request has reached a state it can never leave.
 *
 * Merged pull requests cannot reopen. Closed pull requests can, including
 * after their checkout disappears, so their binding must still refresh.
 */
export function isSettled(state: PullRequestState): boolean {
  return state === "merged";
}

const PULL_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

/**
 * Find a pull request in whatever text a thread carries about itself.
 *
 * A thread spawned to review a pull request nearly always names it — bb's own
 * github plugin titles those threads `owner/repo#123`, and a thread spawned
 * from a URL keeps that URL in its fallback title. When the environment is
 * gone and nothing was bound, this is the last honest source: the thread said
 * what it was for, and we believe it.
 *
 * Only a full URL counts. A bare "#1019" names no repository, and guessing one
 * from the thread's project would turn a wrong guess into a wrong status.
 */
export function parsePullRequestRef(
  ...texts: readonly (string | null | undefined)[]
): PullRequestRef | null {
  for (const text of texts) {
    const match = typeof text === "string" ? text.match(PULL_URL) : null;
    if (match !== null) {
      return { repo: match[1], number: Number(match[2]) };
    }
  }
  return null;
}

/** The `gh pr view --json` fields the snapshot needs, and not one more. */
export const GH_PULL_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "statusCheckRollup",
  "reviewDecision",
  "mergeable",
] as const;

type Check = { status?: unknown; conclusion?: unknown; state?: unknown };

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const PASSED_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * Fold a check rollup into the counts a row can show.
 *
 * The rollup mixes two node types: CheckRun carries status + conclusion, the
 * older StatusContext carries only state. Anything not recognisably finished
 * counts as pending, which is the reading that cannot mislead — a row saying
 * "still running" about a check that has in fact passed costs nothing.
 */
function summarizeChecks(rollup: unknown): {
  state: string;
  failed: number;
} {
  if (!Array.isArray(rollup) || rollup.length === 0) {
    return { state: "no_checks", failed: 0 };
  }
  let failed = 0;
  let pending = 0;
  for (const raw of rollup as Check[]) {
    const verdict =
      typeof raw?.conclusion === "string" && raw.conclusion.length > 0
        ? raw.conclusion
        : typeof raw?.state === "string"
          ? raw.state
          : "";
    if (FAILED_CONCLUSIONS.has(verdict) || verdict === "ERROR") failed += 1;
    else if (!PASSED_CONCLUSIONS.has(verdict)) pending += 1;
  }
  if (failed > 0) return { state: "failing", failed };
  if (pending > 0) return { state: "pending", failed: 0 };
  return { state: "passing", failed: 0 };
}

function stateOf(raw: string, isDraft: boolean): PullRequestState {
  if (raw === "MERGED") return "merged";
  if (raw === "CLOSED") return "closed";
  return isDraft ? "draft" : "open";
}

/**
 * What this pull request wants from a person, in bb's own vocabulary.
 *
 * Ordered by what a person would act on first: a finished pull request wants
 * nothing, a draft is not asking yet, and below that a failure outranks a
 * review which outranks a clean approval.
 */
function attentionOf(
  state: PullRequestState,
  checks: { state: string; failed: number },
  reviewDecision: string,
  mergeable: string,
): string {
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  if (state === "draft") return "draft";
  if (checks.state === "failing") return "checks_failed";
  if (reviewDecision === "CHANGES_REQUESTED") return "changes_requested";
  if (mergeable === "CONFLICTING") return "conflicts";
  if (checks.state === "pending") return "checks_pending";
  if (reviewDecision === "REVIEW_REQUIRED") return "review_requested";
  if (reviewDecision === "APPROVED") return "ready_to_merge";
  return "none";
}

/**
 * Turn one `gh pr view --json` payload into a snapshot.
 *
 * Returns null rather than throwing on anything unrecognisable: a row that
 * keeps its previous label is a better outcome than a batch that dies because
 * one repository answered oddly.
 */
export function pullRequestFromGh(
  raw: unknown,
  ref: PullRequestRef,
): PullRequestSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.state !== "string") return null;
  const state = stateOf(row.state, row.isDraft === true);
  const checks = summarizeChecks(row.statusCheckRollup);
  return {
    number: typeof row.number === "number" ? row.number : ref.number,
    title: typeof row.title === "string" ? row.title : "",
    url:
      typeof row.url === "string"
        ? row.url
        : `https://github.com/${ref.repo}/pull/${ref.number}`,
    state,
    attention: attentionOf(
      state,
      checks,
      typeof row.reviewDecision === "string" ? row.reviewDecision : "",
      typeof row.mergeable === "string" ? row.mergeable : "",
    ),
    checksState: checks.state,
    failedChecks: checks.failed,
  };
}
