// Shared vocabulary for the workspace sidebar. Imported by both the server
// (lib/store.server.ts, server.ts) and the app (components/*), so it must stay
// free of node and react imports.

import type { ManualStatus } from "./status";

/** What a workspace can hold. Threads and projects order independently. */
export type ItemKind = "project" | "thread";

/** How threads are ordered inside a project group. */
export type SortMode = "recent" | "manual";

export interface Workspace {
  id: string;
  name: string;
  sortIndex: number;
  sortMode: SortMode;
  createdAt: number;
}

/**
 * A row exists only when the user has said something explicit. Its absence is
 * meaningful, so there are three states, not two:
 *
 *   no row                 inherit (thread -> its project's workspace,
 *                          project -> Unassigned)
 *   workspaceId: "ws_..."  explicit membership
 *   workspaceId: null      explicit detach: pin to Unassigned, do NOT inherit
 *
 * The third state is what lets a single thread sit outside a workspace its
 * project belongs to. It is meaningless for projects, where "no row" already
 * means Unassigned, and the database CHECK rejects it.
 */
export interface Assignment {
  kind: ItemKind;
  refId: string;
  workspaceId: string | null;
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
export interface WorkspaceState {
  revision: number;
  workspaces: Workspace[];
  assignments: Assignment[];
  lifecycle: Lifecycle[];
}

export interface Placement {
  kind: ItemKind;
  refId: string;
  workspaceId: string | null;
}

export interface ItemRef {
  kind: ItemKind;
  refId: string;
}

export const UNASSIGNED_ID = "__unassigned__";

/** The realtime channel every mutation publishes on. */
export const WORKSPACES_CHANGED = "workspaces-changed";

export function itemKey(kind: ItemKind, refId: string): string {
  return `${kind}:${refId}`;
}
