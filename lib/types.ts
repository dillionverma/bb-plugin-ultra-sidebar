// Shared vocabulary for the sidebar. Imported by both the server
// (lib/store.server.ts, server.ts) and the app (components/*), so it must stay
// free of node and react imports.

import type { ManualStatus } from "./status";

/** What can carry a hand-picked position. Threads and projects order apart. */
export type ItemKind = "project" | "thread";

/**
 * One hand-picked position.
 *
 * A row exists only once the user has dragged something. Its absence is
 * meaningful: an item with no row has never been placed by hand and sorts by
 * recency, above the ones that have — so a brand new thread still arrives at
 * the top of a list somebody has reordered.
 *
 * Positions are global rather than per-section. Whatever the sidebar is
 * grouped by, a section is a slice of the same one order, so a drag inside a
 * status bucket and a drag inside a project group cannot disagree.
 */
export interface OrderEntry {
  kind: ItemKind;
  refId: string;
  sortIndex: number;
}

/**
 * Per-thread triage state.
 *
 * `status` is the bucket the person filed the thread in by hand (Backlog,
 * Done or Canceled), or null when the thread's own facts decide — see
 * lib/status.ts. It sticks until the person changes it.
 *
 * `snoozedUntil` hides a thread until a timestamp passes.
 */
export interface Lifecycle {
  threadId: string;
  status: ManualStatus | null;
  snoozedUntil: number | null;
}

/** Everything the sidebar needs from us, in one payload. */
export interface SidebarState {
  revision: number;
  order: OrderEntry[];
  lifecycle: Lifecycle[];
}

/** An ordered item, before positions are assigned. */
export interface Placement {
  kind: ItemKind;
  refId: string;
}

export type ItemRef = Placement;

/** The realtime channel every mutation publishes on. */
export const SIDEBAR_CHANGED = "sidebar-changed";

export function itemKey(kind: ItemKind, refId: string): string {
  return `${kind}:${refId}`;
}
