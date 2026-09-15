import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { createStore, MIGRATIONS } from "./store.server";
import { UndoHistory } from "./history";

describe("atomic sidebar history", () => {
  function setup() {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS) db.exec(migration);
    const store = createStore(
      db,
      () => {},
      () => "ws1",
    );
    store.createWorkspace("Work");
    return { db, store };
  }
  it("restores status, snooze, exact order and sorting in one step, preserving unrelated work", () => {
    const { db, store } = setup();
    const before = store.readState();
    const after = structuredClone(before);
    after.workspaces[0]!.sortMode = "manual";
    after.assignments = [
      { kind: "thread", refId: "a", workspaceId: "ws1", sortIndex: 0 },
    ];
    after.lifecycle = [{ threadId: "a", status: "done", snoozedUntil: 123 }];
    store.edit(before, after);
    store.setStatus(["other"], "backlog");
    const undone = store.edit(after, before);
    expect(undone.assignments).toEqual([]);
    expect(undone.workspaces[0]!.sortMode).toBe("recent");
    expect(undone.lifecycle).toEqual([
      { threadId: "other", status: "backlog", snoozedUntil: null },
    ]);
    const redone = store.edit(before, after);
    expect(redone.assignments).toEqual(after.assignments);
    expect(redone.lifecycle).toHaveLength(2);
    db.close();
  });
  it("rejects conflicting undo without changing any other row or revision", () => {
    const { db, store } = setup();
    const before = store.readState();
    const after = store.setStatus(["a"], "done");
    store.setStatus(["a"], "backlog");
    const live = store.readState();
    expect(() => store.edit(after, before)).toThrow("changed elsewhere");
    expect(store.readState()).toEqual(live);
    db.close();
  });
  it("rolls back invalid workspace references", () => {
    const { db, store } = setup();
    const before = store.readState();
    expect(() =>
      store.edit(before, {
        ...before,
        assignments: [
          { kind: "thread", refId: "a", workspaceId: "missing", sortIndex: 0 },
        ],
      }),
    ).toThrow();
    expect(store.readState()).toEqual(before);
    db.close();
  });
  it("queues rapid undo/redo and keeps failed entries available to retry", async () => {
    const failed = vi.fn();
    const history = new UndoHistory(() => {}, failed);
    const calls: string[] = [];
    const a = {
      label: "a",
      undo: async () => {
        calls.push("undo a");
      },
      redo: async () => {
        calls.push("redo a");
      },
    };
    const b = {
      label: "b",
      undo: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockImplementation(async () => {
          calls.push("undo b");
        }),
      redo: async () => {
        calls.push("redo b");
      },
    };
    history.record(a);
    history.record(b);
    await history.undo();
    expect(history.past).toHaveLength(2);
    expect(failed).toHaveBeenCalledOnce();
    await Promise.all([history.undo(), history.undo(), history.redo()]);
    expect(calls).toEqual(["undo b", "undo a", "redo a"]);
    history.record(a);
    expect(history.future).toHaveLength(0);
  });
});
