import { useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import {
  placeItem,
  seedGroupOrder,
  toPlacement,
  type DropTarget,
} from "../lib/order";
import {
  WORKSPACES_CHANGED,
  itemKey,
  type ItemRef,
  type SortMode,
  type WorkspaceState,
  type Placement,
  type Assignment,
} from "../lib/types";
import type { ManualStatus } from "../lib/status";
import { UndoHistory } from "../lib/history";
const EMPTY_STATE: WorkspaceState = {
  revision: -1,
  workspaces: [],
  assignments: [],
  lifecycle: [],
};
export interface WorkspacesApi {
  state: WorkspaceState;
  isLoading: boolean;
  error: string | null;
  createWorkspace(name: string): Promise<string | null>;
  renameWorkspace(id: string, name: string): void;
  removeWorkspace(id: string, reassign: string | "detach"): void;
  reorderWorkspaces(orderedIds: string[]): void;
  setSortMode(id: string, sortMode: SortMode): void;
  /** Move one item; the full post-drop list is derived here. */
  moveItem(item: ItemRef, target: DropTarget): void;
  /**
   * Rewrite one group's order outright. Used for manual reordering, which has
   * to seed positions for every member at once — otherwise the first drag
   * gives one thread a position and drops the rest to the unordered tail,
   * which reads as the sidebar scrambling itself.
   */
  reorderGroup(
    kind: ItemRef["kind"],
    workspaceId: string | null,
    orderedRefIds: string[],
  ): void;
  /** Drop the explicit row so the item goes back to inheriting. */
  clearItems(items: ItemRef[]): void;
  /** File threads in a bucket by hand; null lets their own facts decide. */
  setStatus(threadIds: string[], status: ManualStatus | null): void;
  /** Hide a thread until a timestamp; null wakes it. */
  setSnoozed(threadId: string, until: number | null): void;
}

type Change = (state: WorkspaceState) => WorkspaceState;
export function useWorkspaces() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [error, setError] = useState<string | null>(null);
  const [, render] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const adopt = (next: WorkspaceState) => {
    if (alive.current) {
      setState((old) => (next.revision >= old.revision ? next : old));
      setError(null);
    }
  };
  const report = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (alive.current) setError(message);
    toast.error(message);
  };
  const historyRef = useRef<UndoHistory | null>(null);
  if (!historyRef.current)
    historyRef.current = new UndoHistory(
      () => {
        if (alive.current) render((n) => n + 1);
      },
      report,
      () => toast.dismiss("sidebar-action"),
    );
  const history = historyRef.current;
  const refetch = () => rpc.call("workspaces.state").then(adopt, report);
  useEffect(() => {
    void refetch();
  }, [connection]);
  useRealtime(WORKSPACES_CHANGED, (payload) => {
    const revision =
      typeof payload === "object" && payload !== null && "revision" in payload
        ? Number(payload.revision)
        : NaN;
    if (!Number.isFinite(revision) || revision > stateRef.current.revision)
      void refetch();
  });
  const edit = async (before: WorkspaceState, after: WorkspaceState) => {
    adopt(await rpc.call("workspaces.edit", { before, after }));
  };
  const changes = useRef<Change[] | null>(null);
  const change = (label: string, transform: Change) => {
    if (changes.current) {
      changes.current.push(transform);
      return;
    }
    void history.enqueue(async () => {
      const before = await rpc.call("workspaces.state");
      const after = transform(before);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      await edit(before, after);
      history.record({
        label,
        undo: () => edit(after, before),
        redo: () => edit(before, after),
      });
      toast.success(label, {
        id: "sidebar-action",
        action: {
          label: "Undo",
          onClick: () => {
            void history.undo();
          },
        },
      });
    });
  };
  const batch = (label: string, action: () => void) => {
    if (changes.current) {
      action();
      return;
    }
    changes.current = [];
    let pending: Change[];
    try {
      action();
      pending = changes.current;
    } finally {
      changes.current = null;
    }
    change(label, (state) => pending.reduce((s, fn) => fn(s), state));
  };
  const lifecycle =
    (
      ids: string[],
      patch: { status?: ManualStatus | null; snoozedUntil?: number | null },
    ) =>
    (s: WorkspaceState) => {
      const rows = new Map(s.lifecycle.map((row) => [row.threadId, row]));
      for (const id of ids)
        rows.set(id, {
          threadId: id,
          status: null,
          snoozedUntil: null,
          ...rows.get(id),
          ...patch,
        });
      return { ...s, lifecycle: [...rows.values()] };
    };
  const api: WorkspacesApi = {
    state,
    error,
    isLoading: state.revision < 0 && error === null,
    createWorkspace: async (name) => {
      const id = `ws_${crypto.randomUUID()}`;
      change("Workspace created", (s) => ({
        ...s,
        workspaces: [
          ...s.workspaces,
          {
            id,
            name,
            sortIndex: s.workspaces.length,
            sortMode: "recent",
            createdAt: Date.now(),
          },
        ],
      }));
      return id;
    },
    renameWorkspace: (id, name) =>
      change("Workspace renamed", (s) => ({
        ...s,
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
      })),
    removeWorkspace: (id, reassign) =>
      change("Workspace removed", (s) => ({
        ...s,
        workspaces: s.workspaces.filter((w) => w.id !== id),
        assignments:
          reassign === "detach"
            ? s.assignments.filter((a) => a.workspaceId !== id)
            : s.assignments.map((a) =>
                a.workspaceId === id ? { ...a, workspaceId: reassign } : a,
              ),
      })),
    reorderWorkspaces: (ids) =>
      change("Workspaces reordered", (s) => ({
        ...s,
        workspaces: s.workspaces
          .map((w) => ({
            ...w,
            sortIndex: ids.indexOf(w.id) < 0 ? w.sortIndex : ids.indexOf(w.id),
          }))
          .sort((a, b) => a.sortIndex - b.sortIndex),
      })),
    setSortMode: (id, sortMode) =>
      change("Sorting changed", (s) => ({
        ...s,
        workspaces: s.workspaces.map((w) =>
          w.id === id ? { ...w, sortMode } : w,
        ),
      })),
    moveItem: (item, target) =>
      change("Moved to workspace", (s) => ({
        ...s,
        assignments: toAssignments(
          placeItem(s.assignments.map(toPlacement), item, target),
        ),
      })),
    reorderGroup: (kind, workspaceId, ids) =>
      change("Order changed", (s) => ({
        ...s,
        assignments: toAssignments(
          seedGroupOrder(
            s.assignments.map(toPlacement),
            kind,
            workspaceId,
            ids,
          ),
        ),
      })),
    clearItems: (items) =>
      change("Workspace assignment cleared", (s) => ({
        ...s,
        assignments: s.assignments.filter(
          (a) =>
            !items.some(
              (i) => itemKey(i.kind, i.refId) === itemKey(a.kind, a.refId),
            ),
        ),
      })),
    setStatus: (ids, status) =>
      change(
        status === "done"
          ? "Marked done"
          : status === null
            ? "Reopened"
            : "Status changed",
        lifecycle(ids, { status }),
      ),
    setSnoozed: (id, until) =>
      change(
        until === null ? "Thread woken" : "Thread snoozed",
        lifecycle([id], { snoozedUntil: until }),
      ),
  };
  return { ...api, batch, history };
}
function toAssignments(placements: readonly Placement[]): Assignment[] {
  return placements
    .filter((p) => p.kind !== "project" || p.workspaceId !== null)
    .map((p, sortIndex) => ({ ...p, sortIndex }));
}
