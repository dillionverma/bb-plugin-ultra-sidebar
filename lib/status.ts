// The five statuses a thread can be in, after Conductor (and Linear before it).
//
// Two kinds of fact feed this. The person can file a thread by hand into
// Backlog, Done or Canceled, and that sticks until they change it. Everything
// else is read off the thread's pull request: merged is Done, open is In
// review, and a thread with nothing to say about itself is simply In progress
// — the default, and the only bucket with no explicit cause.
//
// Free of react and node imports: the server's CLI and the app both use it.

/** The statuses a person can set by hand. Everything else is derived. */
export type ManualStatus = "backlog" | "done" | "canceled";

export const MANUAL_STATUSES: readonly ManualStatus[] = [
  "backlog",
  "done",
  "canceled",
];

export function isManualStatus(value: unknown): value is ManualStatus {
  return (MANUAL_STATUSES as readonly unknown[]).includes(value);
}

export type StatusBucket = "done" | "in-review" | "in-progress" | ManualStatus;

/**
 * Buckets in the order the sidebar shows them: finished work on top, then what
 * is waiting on a person, then what is moving, then the two parked piles.
 */
export const STATUS_BUCKETS: readonly { key: StatusBucket; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "in-review", label: "In review" },
  { key: "in-progress", label: "In progress" },
  { key: "backlog", label: "Backlog" },
  { key: "canceled", label: "Canceled" },
];

export const STATUS_LABEL: Record<StatusBucket, string> = Object.fromEntries(
  STATUS_BUCKETS.map((bucket) => [bucket.key, bucket.label]),
) as Record<StatusBucket, string>;

export function isStatusBucket(value: unknown): value is StatusBucket {
  return STATUS_BUCKETS.some((bucket) => bucket.key === value);
}

/** Buckets that leave the active list: outside the status view they are
 *  filed under their own heading at the bottom rather than mixed in. */
export const PARKED_BUCKETS: readonly StatusBucket[] = [
  "done",
  "backlog",
  "canceled",
];

/** The subset of a pull request that decides a bucket. */
export interface PullRequestLike {
  state: "open" | "draft" | "merged" | "closed";
}

/**
 * Which bucket a thread belongs in.
 *
 * A manual status wins outright: filing something in Backlog while its PR is
 * open is a decision, and the sidebar's job is to respect it. Below that the
 * pull request decides, and a draft PR is not yet a request for review.
 */
export function statusBucket(
  manual: ManualStatus | null,
  pullRequest: PullRequestLike | undefined,
): StatusBucket {
  if (manual !== null) return manual;
  if (pullRequest !== undefined) {
    if (pullRequest.state === "merged") return "done";
    if (pullRequest.state === "closed") return "canceled";
    if (pullRequest.state === "open") return "in-review";
  }
  return "in-progress";
}

export const STATUS_SECTION_PREFIX = "status:";

export function statusSectionId(bucket: StatusBucket): string {
  return `${STATUS_SECTION_PREFIX}${bucket}`;
}

export function bucketFromSectionId(id: string | null): StatusBucket | null {
  if (id === null || !id.startsWith(STATUS_SECTION_PREFIX)) return null;
  const key = id.slice(STATUS_SECTION_PREFIX.length);
  return isStatusBucket(key) ? key : null;
}
