import { useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import {
  clearGroupOrder,
  placeItem,
  seedGroupOrder,
  toPlacement,
  type DropTarget,
} from "../lib/order";
import {
  SIDEBAR_CHANGED,
  itemKey,
  type ItemRef,
  type OrderEntry,
  type Placement,
  type SidebarState,
} from "../lib/types";
import type { ManualStatus } from "../lib/status";
import { UndoHistory } from "../lib/history";

const EMPTY_STATE: SidebarState = { revision: -1, order: [], lifecycle: [] };

export interface SidebarStoreApi {
  state: SidebarState;
  isLoading: boolean;
  error: string | null;
  /** Move one item; the full post-drop list is derived here. */
  moveItem(item: ItemRef, target: DropTarget): void;
  /**
   * Rewrite one section's order outright. Used for manual reordering, which
   * has to seed positions for every member at once — otherwise the first drag
   * gives one thread a position and leaves the rest without one, which sorts
   * them back above it and reads as the drop having failed.
   */
  reorderGroup(kind: ItemRef["kind"], orderedRefIds: string[]): void;
  /** Drop hand-picked positions, so these rows sort by recency again. */
  resetOrder(kind: ItemRef["kind"], refIds: string[]): void;
  /** File threads in a bucket by hand; null lets their own facts decide. */
  setStatus(threadIds: string[], status: ManualStatus | null): void;
  /** Hide a thread until a timestamp; null wakes it. */
  setSnoozed(threadId: string, until: number | null): void;
  /**
   * Clear a snooze the resolver has already overridden (the thread needs a
   * person or is working). Not the user's action, so no toast and no undo
   * entry: undoing it would re-hide a thread that is asking for them.
   */
  wakeEarly(threadIds: string[]): void;
}

type Change = (state: SidebarState) => SidebarState;

export function useSidebarStore() {
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
  const adopt = (next: SidebarState) => {
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
  const refetch = () => rpc.call("sidebar.state").then(adopt, report);
  useEffect(() => {
    void refetch();
  }, [connection]);
  useRealtime(SIDEBAR_CHANGED, (payload) => {
    const revision =
      typeof payload === "object" && payload !== null && "revision" in payload
        ? Number(payload.revision)
        : NaN;
    if (!Number.isFinite(revision) || revision > stateRef.current.revision)
      void refetch();
  });
  const edit = async (before: SidebarState, after: SidebarState) => {
    adopt(await rpc.call("sidebar.edit", { before, after }));
  };
  const changes = useRef<Change[] | null>(null);
  const change = (
    label: string,
    transform: Change,
    toastOptions: { duration?: number } = {},
  ) => {
    if (changes.current) {
      changes.current.push(transform);
      return;
    }
    void history.enqueue(async () => {
      const before = await rpc.call("sidebar.state");
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
        ...toastOptions,
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
    (s: SidebarState) => {
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
  const api: SidebarStoreApi = {
    state,
    error,
    isLoading: state.revision < 0 && error === null,
    moveItem: (item, target) =>
      change("Order changed", (s) => ({
        ...s,
        order: toOrder(placeItem(s.order.map(toPlacement), item, target)),
      })),
    reorderGroup: (kind, ids) =>
      change("Order changed", (s) => ({
        ...s,
        order: toOrder(seedGroupOrder(s.order.map(toPlacement), kind, ids)),
      })),
    resetOrder: (kind, ids) =>
      change("Sorted by most recent", (s) => ({
        ...s,
        order: toOrder(clearGroupOrder(s.order.map(toPlacement), kind, ids)),
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
        until === null ? undefined : { duration: 8000 },
      ),
    wakeEarly: (ids) =>
      void history.enqueue(async () => {
        const before = await rpc.call("sidebar.state");
        const after = lifecycle(ids, { snoozedUntil: null })(before);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        await edit(before, after);
      }),
  };
  return { ...api, batch, history };
}

function toOrder(placements: readonly Placement[]): OrderEntry[] {
  return placements.map((placement, sortIndex) => ({
    ...placement,
    sortIndex,
  }));
}

/** True when this item carries a hand-picked position. */
export function isPlaced(state: SidebarState, item: ItemRef): boolean {
  const key = itemKey(item.kind, item.refId);
  return state.order.some((entry) => itemKey(entry.kind, entry.refId) === key);
}
