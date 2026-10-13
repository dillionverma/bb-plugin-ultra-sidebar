import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { createStore, MIGRATIONS } from "./store.server";
import { UndoHistory } from "./history";

describe("atomic sidebar history", () => {
  function setup() {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS) db.exec(migration);
    return { db, store: createStore(db, () => {}) };
  }
  it("restores status, snooze and exact order in one step, preserving unrelated work", () => {
    const { db, store } = setup();
    const before = store.readState();
    const after = structuredClone(before);
    after.order = [{ kind: "thread", refId: "a", sortIndex: 0 }];
    after.lifecycle = [{ threadId: "a", status: "done", snoozedUntil: 123 }];
    store.edit(before, after);
    store.setStatus(["other"], "backlog");
    const undone = store.edit(after, before);
    expect(undone.order).toEqual([]);
    expect(undone.lifecycle).toEqual([
      { threadId: "other", status: "backlog", snoozedUntil: null },
    ]);
    const redone = store.edit(before, after);
    expect(redone.order).toEqual(after.order);
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
  it("carries an order forward, without leaving holes in the positions", () => {
    const { db, store } = setup();
    store.placeOrder([
      { kind: "thread", refId: "a" },
      { kind: "thread", refId: "b" },
      { kind: "project", refId: "p1" },
    ]);
    expect(store.readState().order).toEqual([
      { kind: "thread", refId: "a", sortIndex: 0 },
      { kind: "thread", refId: "b", sortIndex: 1 },
      { kind: "project", refId: "p1", sortIndex: 2 },
    ]);
    store.clearOrder([{ kind: "thread", refId: "a" }]);
    expect(store.readState().order.map((row) => row.refId)).toEqual(["b", "p1"]);
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
