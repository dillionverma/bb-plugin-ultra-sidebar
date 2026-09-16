import type { SidebarState } from "./types";

// Apply only rows changed by this action. Unrelated edits from another client
// survive; a conflicting edit fails atomically instead of silently overwriting it.
export function applyStateChange(
  current: SidebarState,
  before: SidebarState,
  after: SidebarState,
): SidebarState {
  const merge = <T>(
    liveRows: T[],
    oldRows: T[],
    nextRows: T[],
    key: (row: T) => string,
  ): T[] => {
    const old = new Map(oldRows.map((row) => [key(row), row]));
    const next = new Map(nextRows.map((row) => [key(row), row]));
    const live = new Map(liveRows.map((row) => [key(row), row]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      if (JSON.stringify(old.get(id)) === JSON.stringify(next.get(id)))
        continue;
      if (JSON.stringify(live.get(id)) !== JSON.stringify(old.get(id))) {
        throw new Error("This item changed elsewhere. Refresh and try again.");
      }
      const replacement = next.get(id);
      if (replacement !== undefined) live.set(id, replacement);
      else live.delete(id);
    }
    return [...live.values()];
  };
  const result: SidebarState = {
    revision: current.revision,
    order: merge(
      current.order,
      before.order,
      after.order,
      (row) => `${row.kind}:${row.refId}`,
    ),
    lifecycle: merge(
      current.lifecycle,
      before.lifecycle,
      after.lifecycle,
      (row) => row.threadId,
    ),
  };
  result.order.sort((a, b) => a.sortIndex - b.sortIndex);
  return result;
}

export interface HistoryEntry {
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}
export class UndoHistory {
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  pending = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private changed: () => void,
    private failed: (error: unknown) => void,
    private navigated: () => void = () => {},
  ) {}
  enqueue(action: () => Promise<void>) {
    this.pending += 1;
    this.changed();
    const next = this.queue.then(action);
    this.queue = next.catch(this.failed).finally(() => {
      this.pending -= 1;
      this.changed();
    });
    return this.queue;
  }
  record(entry: HistoryEntry) {
    this.past.push(entry);
    this.past = this.past.slice(-50);
    this.future = [];
    this.changed();
  }
  undo = () =>
    this.enqueue(async () => {
      const entry = this.past.at(-1);
      if (!entry) return;
      await entry.undo();
      this.past.pop();
      this.future.push(entry);
      this.navigated();
      this.changed();
    });
  redo = () =>
    this.enqueue(async () => {
      const entry = this.future.at(-1);
      if (!entry) return;
      await entry.redo();
      this.future.pop();
      this.past.push(entry);
      this.navigated();
      this.changed();
    });
}
