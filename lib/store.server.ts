// SQLite layer. Server-only: importing this from app.tsx would drag
// better-sqlite3 into the browser bundle.
import { applyStateChange } from "./history";
import type { Database } from "better-sqlite3";
import type {
  Assignment,
  ItemRef,
  Lifecycle,
  Placement,
  SortMode,
  Workspace,
  WorkspaceState,
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
];

interface WorkspaceRow {
  id: string;
  name: string;
  sort_index: number;
  sort_mode: string;
  created_at: number;
}

interface LifecycleRow {
  thread_id: string;
  status: string | null;
  snoozed_until: number | null;
}

interface AssignmentRow {
  kind: string;
  ref_id: string;
  workspace_id: string | null;
  sort_index: number;
}

export interface Store {
  readState(): WorkspaceState;
  edit(before: WorkspaceState, after: WorkspaceState): WorkspaceState;
  createWorkspace(name: string): {
    workspace: Workspace;
    state: WorkspaceState;
  };
  renameWorkspace(id: string, name: string): WorkspaceState;
  removeWorkspace(id: string, reassign: string | "detach"): WorkspaceState;
  reorderWorkspaces(orderedIds: string[]): WorkspaceState;
  setSortMode(id: string, sortMode: SortMode): WorkspaceState;
  placeAssignments(placements: Placement[]): WorkspaceState;
  clearAssignments(items: ItemRef[]): WorkspaceState;
  /** File threads in a bucket by hand; null lets their own facts decide. */
  setStatus(threadIds: string[], status: ManualStatus | null): WorkspaceState;
  setSnoozed(threadId: string, until: number | null): WorkspaceState;
  /** Drop rows for projects/threads that no longer exist. */
  pruneAssignments(items: ItemRef[]): {
    removed: number;
    state: WorkspaceState;
  };
  findWorkspace(
    selector: string,
  ): Workspace | { ambiguous: Workspace[] } | null;
}

export function createStore(
  db: Database,
  onChange: (revision: number) => void,
  newId: () => string,
): Store {
  // ON DELETE CASCADE is inert unless this is set, and the pragma is
  // per-connection rather than stored in the file. It deliberately does not
  // live in MIGRATIONS (that would burn a migration index on a setting that
  // does not persist), and every delete below also removes its rows
  // explicitly so correctness never depends on it.
  db.pragma("foreign_keys = ON");

  const selectWorkspaces = db.prepare<[], WorkspaceRow>(
    `SELECT id, name, sort_index, sort_mode, created_at
       FROM workspaces ORDER BY sort_index ASC, name ASC`,
  );
  const selectAssignments = db.prepare<[], AssignmentRow>(
    `SELECT kind, ref_id, workspace_id, sort_index
       FROM assignments ORDER BY sort_index ASC`,
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
  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, name, sort_index, sort_mode, created_at)
     VALUES (?, ?, ?, 'recent', ?)`,
  );
  const maxWorkspaceIndex = db.prepare<[], { value: number | null }>(
    `SELECT MAX(sort_index) AS value FROM workspaces`,
  );

  function readRevision(): number {
    const row = selectRevision.get();
    const parsed = Number.parseInt(row?.value ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toWorkspace(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      name: row.name,
      sortIndex: row.sort_index,
      sortMode: row.sort_mode === "manual" ? "manual" : "recent",
      createdAt: row.created_at,
    };
  }

  function toAssignment(row: AssignmentRow): Assignment {
    return {
      kind: row.kind === "project" ? "project" : "thread",
      refId: row.ref_id,
      workspaceId: row.workspace_id,
      sortIndex: row.sort_index,
    };
  }

  function readState(): WorkspaceState {
    return {
      revision: readRevision(),
      workspaces: selectWorkspaces.all().map(toWorkspace),
      assignments: selectAssignments.all().map(toAssignment),
      lifecycle: selectLifecycle.all().map((row): Lifecycle => ({
        threadId: row.thread_id,
        status: isManualStatus(row.status) ? row.status : null,
        snoozedUntil: row.snoozed_until,
      })),
    };
  }

  /**
   * The only write path. Owning BEGIN, the revision bump and the notification
   * in one place is what guarantees no mutation — RPC or CLI — can slip out
   * without every open sidebar hearing about it.
   */
  function withWrite<T>(mutate: () => T): { result: T; state: WorkspaceState } {
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

  const rewriteAssignments = db.transaction((placements: Placement[]) => {
    db.prepare(`DELETE FROM assignments`).run();
    const insert = db.prepare(
      `INSERT INTO assignments (kind, ref_id, workspace_id, sort_index)
       VALUES (?, ?, ?, ?)`,
    );
    placements.forEach((placement, index) => {
      // A project has no "detached" state; skip rather than trip the CHECK.
      if (placement.kind === "project" && placement.workspaceId === null)
        return;
      insert.run(placement.kind, placement.refId, placement.workspaceId, index);
    });
  });

  return {
    readState,
    edit(before, after) {
      return withWrite(() => {
        const next = applyStateChange(readState(), before, after);
        db.prepare("DELETE FROM assignments").run();
        db.prepare("DELETE FROM workspaces").run();
        const ws = db.prepare(
          "INSERT INTO workspaces (id,name,sort_index,sort_mode,created_at) VALUES (?,?,?,?,?)",
        );
        for (const w of next.workspaces)
          ws.run(w.id, w.name, w.sortIndex, w.sortMode, w.createdAt);
        const assignment = db.prepare(
          "INSERT INTO assignments (kind,ref_id,workspace_id,sort_index) VALUES (?,?,?,?)",
        );
        for (const a of next.assignments)
          assignment.run(a.kind, a.refId, a.workspaceId, a.sortIndex);
        db.prepare("DELETE FROM thread_lifecycle").run();
        const life = db.prepare(
          "INSERT INTO thread_lifecycle (thread_id,status,snoozed_until) VALUES (?,?,?)",
        );
        for (const l of next.lifecycle)
          life.run(l.threadId, l.status, l.snoozedUntil);
      }).state;
    },

    createWorkspace(name) {
      const { result, state } = withWrite(() => {
        const id = newId();
        const nextIndex = (maxWorkspaceIndex.get()?.value ?? -1) + 1;
        insertWorkspace.run(id, name, nextIndex, Date.now());
        return id;
      });
      const workspace = state.workspaces.find((item) => item.id === result);
      if (workspace === undefined) {
        throw new Error("Workspace disappeared immediately after creation");
      }
      return { workspace, state };
    },

    renameWorkspace(id, name) {
      return withWrite(() => {
        const info = db
          .prepare(`UPDATE workspaces SET name = ? WHERE id = ?`)
          .run(name, id);
        if (info.changes === 0) throw new Error(`No workspace with id ${id}`);
      }).state;
    },

    removeWorkspace(id, reassign) {
      return withWrite(() => {
        const exists = db
          .prepare(`SELECT 1 FROM workspaces WHERE id = ?`)
          .get(id);
        if (exists === undefined) throw new Error(`No workspace with id ${id}`);
        if (reassign === "detach") {
          // Members fall back to inheriting / Unassigned.
          db.prepare(`DELETE FROM assignments WHERE workspace_id = ?`).run(id);
        } else {
          const target = db
            .prepare(`SELECT 1 FROM workspaces WHERE id = ?`)
            .get(reassign);
          if (target === undefined) {
            throw new Error(`No workspace with id ${reassign}`);
          }
          db.prepare(
            `UPDATE assignments SET workspace_id = ? WHERE workspace_id = ?`,
          ).run(reassign, id);
        }
        db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
      }).state;
    },

    reorderWorkspaces(orderedIds) {
      return withWrite(() => {
        const update = db.prepare(
          `UPDATE workspaces SET sort_index = ? WHERE id = ?`,
        );
        orderedIds.forEach((id, index) => update.run(index, id));
      }).state;
    },

    setSortMode(id, sortMode) {
      return withWrite(() => {
        const info = db
          .prepare(`UPDATE workspaces SET sort_mode = ? WHERE id = ?`)
          .run(sortMode, id);
        if (info.changes === 0) throw new Error(`No workspace with id ${id}`);
      }).state;
    },

    placeAssignments(placements) {
      return withWrite(() => {
        const known = new Set(selectWorkspaces.all().map((row) => row.id));
        for (const placement of placements) {
          if (
            placement.workspaceId !== null &&
            !known.has(placement.workspaceId)
          ) {
            throw new Error(`No workspace with id ${placement.workspaceId}`);
          }
        }
        rewriteAssignments(placements);
      }).state;
    },

    clearAssignments(items) {
      return withWrite(() => {
        const remove = db.prepare(
          `DELETE FROM assignments WHERE kind = ? AND ref_id = ?`,
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

    pruneAssignments(items) {
      if (items.length === 0) return { removed: 0, state: readState() };
      const { result, state } = withWrite(() => {
        const remove = db.prepare(
          `DELETE FROM assignments WHERE kind = ? AND ref_id = ?`,
        );
        let removed = 0;
        for (const item of items) {
          removed += remove.run(item.kind, item.refId).changes;
        }
        return removed;
      });
      return { removed: result, state };
    },

    findWorkspace(selector) {
      const workspaces = selectWorkspaces.all().map(toWorkspace);
      const exact = workspaces.find(
        (workspace) =>
          workspace.id === selector ||
          workspace.name.toLowerCase() === selector.toLowerCase(),
      );
      if (exact !== undefined) return exact;
      const prefix = workspaces.filter((workspace) =>
        workspace.name.toLowerCase().startsWith(selector.toLowerCase()),
      );
      if (prefix.length === 1) return prefix[0]!;
      if (prefix.length > 1) return { ambiguous: prefix };
      return null;
    },
  };
}
