// SQLite layer. Server-only: importing this from app.tsx would drag
// better-sqlite3 into the browser bundle.
import { applyStateChange } from "./history";
import type { Database } from "better-sqlite3";
import type {
  ItemKind,
  ItemRef,
  Lifecycle,
  OrderEntry,
  Placement,
  SidebarState,
} from "./types";
import { isManualStatus, type ManualStatus } from "./status";

/**
 * APPEND-ONLY. bb.storage.migrate hashes each statement by its index and
 * refuses a changed one, so editing anything already in this array bricks the
 * plugin for every existing install. New columns go in a new ALTER TABLE
 * statement at the end.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     sort_index INTEGER NOT NULL,
     sort_mode  TEXT NOT NULL DEFAULT 'recent'
                CHECK (sort_mode IN ('recent','manual')),
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS assignments (
     kind         TEXT NOT NULL CHECK (kind IN ('project','thread')),
     ref_id       TEXT NOT NULL,
     workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
     sort_index   INTEGER NOT NULL,
     CHECK (workspace_id IS NOT NULL OR kind = 'thread'),
     PRIMARY KEY (kind, ref_id)
   )`,
  `CREATE INDEX IF NOT EXISTS assignments_by_workspace
     ON assignments (workspace_id, kind, sort_index)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('revision', '0')`,
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id     TEXT PRIMARY KEY,
     settled_at    INTEGER,
     snoozed_until INTEGER
   )`,
  // The Conductor-style status replaced "settled". settled_at stays in the
  // schema (append-only) but is no longer read; anything settled is Done.
  `ALTER TABLE thread_lifecycle ADD COLUMN status TEXT`,
  `UPDATE thread_lifecycle SET status = 'done'
    WHERE settled_at IS NOT NULL AND status IS NULL`,
  // Workspaces are gone: projects are the only containers now, so a hand-
  // picked position no longer belongs to one. `assignments` and `workspaces`
  // stay in the file (append-only migrations cannot drop what earlier ones
  // created without stranding a rollback) but nothing reads them again.
  `CREATE TABLE IF NOT EXISTS item_order (
     kind       TEXT NOT NULL CHECK (kind IN ('project','thread')),
     ref_id     TEXT NOT NULL,
     sort_index INTEGER NOT NULL,
     PRIMARY KEY (kind, ref_id)
   )`,
  // Carry the old order across: within a workspace the relative order is all
  // that ever showed, and sort_index was already global and dense.
  `INSERT OR IGNORE INTO item_order (kind, ref_id, sort_index)
     SELECT kind, ref_id, sort_index FROM assignments`,
];

interface LifecycleRow {
  thread_id: string;
  status: string | null;
  snoozed_until: number | null;
}

interface OrderRow {
  kind: string;
  ref_id: string;
  sort_index: number;
}

export interface Store {
  readState(): SidebarState;
  edit(before: SidebarState, after: SidebarState): SidebarState;
  /** Replace the whole order with this list, positions taken from the index. */
  placeOrder(placements: Placement[]): SidebarState;
  /** Drop positions, so these items sort by recency again. */
  clearOrder(items: ItemRef[]): SidebarState;
  /** File threads in a bucket by hand; null lets their own facts decide. */
  setStatus(threadIds: string[], status: ManualStatus | null): SidebarState;
  setSnoozed(threadId: string, until: number | null): SidebarState;
  /** Drop rows for projects/threads that no longer exist. */
  pruneOrder(items: ItemRef[]): { removed: number; state: SidebarState };
}

export function createStore(
  db: Database,
  onChange: (revision: number) => void,
): Store {
  const selectOrder = db.prepare<[], OrderRow>(
    `SELECT kind, ref_id, sort_index FROM item_order ORDER BY sort_index ASC`,
  );
  const selectLifecycle = db.prepare<[], LifecycleRow>(
    `SELECT thread_id, status, snoozed_until FROM thread_lifecycle`,
  );
  const selectRevision = db.prepare<[], { value: string }>(
    `SELECT value FROM meta WHERE key = 'revision'`,
  );
  const bumpRevision = db.prepare(
    `UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
      WHERE key = 'revision'`,
  );

  function readRevision(): number {
    const row = selectRevision.get();
    const parsed = Number.parseInt(row?.value ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toOrderEntry(row: OrderRow): OrderEntry {
    return {
      kind: row.kind === "project" ? "project" : "thread",
      refId: row.ref_id,
      sortIndex: row.sort_index,
    };
  }

  function readState(): SidebarState {
    return {
      revision: readRevision(),
      order: selectOrder.all().map(toOrderEntry),
      lifecycle: selectLifecycle.all().map(
        (row): Lifecycle => ({
          threadId: row.thread_id,
          status: isManualStatus(row.status) ? row.status : null,
          snoozedUntil: row.snoozed_until,
        }),
      ),
    };
  }

  /**
   * The only write path. Owning BEGIN, the revision bump and the notification
   * in one place is what guarantees no mutation — RPC or CLI — can slip out
   * without every open sidebar hearing about it.
   */
  function withWrite<T>(mutate: () => T): { result: T; state: SidebarState } {
    const run = db.transaction(() => {
      const result = mutate();
      bumpRevision.run();
      return result;
    });
    const result = run();
    const state = readState();
    onChange(state.revision);
    return { result, state };
  }

  const rewriteOrder = (entries: readonly { kind: ItemKind; refId: string }[]) => {
    db.prepare(`DELETE FROM item_order`).run();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO item_order (kind, ref_id, sort_index)
       VALUES (?, ?, ?)`,
    );
    entries.forEach((entry, index) => {
      insert.run(entry.kind, entry.refId, index);
    });
  };

  return {
    readState,

    edit(before, after) {
      return withWrite(() => {
        const next = applyStateChange(readState(), before, after);
        rewriteOrder(next.order);
        db.prepare("DELETE FROM thread_lifecycle").run();
        const life = db.prepare(
          "INSERT INTO thread_lifecycle (thread_id,status,snoozed_until) VALUES (?,?,?)",
        );
        for (const entry of next.lifecycle) {
          life.run(entry.threadId, entry.status, entry.snoozedUntil);
        }
      }).state;
    },

    placeOrder(placements) {
      return withWrite(() => rewriteOrder(placements)).state;
    },

    clearOrder(items) {
      return withWrite(() => {
        const remove = db.prepare(
          `DELETE FROM item_order WHERE kind = ? AND ref_id = ?`,
        );
        for (const item of items) remove.run(item.kind, item.refId);
      }).state;
    },

    setStatus(threadIds, status) {
      return withWrite(() => {
        const mark = db.prepare(
          `INSERT INTO thread_lifecycle (thread_id, status, snoozed_until)
           VALUES (?, ?, NULL)
           ON CONFLICT(thread_id) DO UPDATE SET status = excluded.status`,
        );
        for (const threadId of threadIds) mark.run(threadId, status);
      }).state;
    },

    setSnoozed(threadId, until) {
      return withWrite(() => {
        db.prepare(
          `INSERT INTO thread_lifecycle (thread_id, status, snoozed_until)
           VALUES (?, NULL, ?)
           ON CONFLICT(thread_id) DO UPDATE SET snoozed_until = excluded.snoozed_until`,
        ).run(threadId, until);
      }).state;
    },

    pruneOrder(items) {
      if (items.length === 0) return { removed: 0, state: readState() };
      const { result, state } = withWrite(() => {
        const remove = db.prepare(
          `DELETE FROM item_order WHERE kind = ? AND ref_id = ?`,
        );
        let removed = 0;
        for (const item of items) {
          removed += remove.run(item.kind, item.refId).changes;
        }
        return removed;
      });
      return { removed: result, state };
    },
  };
}
