import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createStore, MIGRATIONS } from "./store.server";

function setup() {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  return createStore(db, () => {});
}

describe("recordPrompt", () => {
  it("records when the person last prompted a thread", () => {
    const store = setup();
    const state = store.recordPrompt("t1", 1_700);
    expect(state.prompts).toEqual([{ threadId: "t1", lastPromptedAt: 1_700 }]);
    expect(store.recordPrompt("t1", 2_500).prompts).toEqual([
      { threadId: "t1", lastPromptedAt: 2_500 },
    ]);
  });

  it("drops the thread's hand-picked position, so prompting wins over a drag", () => {
    const store = setup();
    store.placeOrder([
      { kind: "thread", refId: "t1" },
      { kind: "thread", refId: "t2" },
      { kind: "project", refId: "p1" },
    ]);
    const state = store.recordPrompt("t1", 1_700);
    // t1 rejoins the recency-sorted rows; everything else keeps its place.
    expect(state.order).toEqual([
      { kind: "thread", refId: "t2", sortIndex: 1 },
      { kind: "project", refId: "p1", sortIndex: 2 },
    ]);
  });

  it("leaves a project of the same id alone: only threads are prompted", () => {
    const store = setup();
    store.placeOrder([{ kind: "project", refId: "t1" }]);
    expect(store.recordPrompt("t1", 1_700).order).toEqual([
      { kind: "project", refId: "t1", sortIndex: 0 },
    ]);
  });

  it("publishes the change, so every open sidebar reorders together", () => {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS) db.exec(migration);
    const revisions: number[] = [];
    const store = createStore(db, (revision) => revisions.push(revision));
    store.recordPrompt("t1", 1_700);
    store.recordPrompt("t1", 1_800);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toBeGreaterThan(revisions[0]);
  });

  it("survives an undo of unrelated work", () => {
    const store = setup();
    const before = store.readState();
    store.recordPrompt("t1", 1_700);
    const after = { ...store.readState(), lifecycle: [{ threadId: "t2", status: "done" as const, snoozedUntil: null }] };
    store.edit(store.readState(), after);
    // Undo the status change; the prompt is not an arrangement to step back
    // through, so it stays.
    const undone = store.edit(after, { ...before, revision: after.revision });
    expect(undone.prompts).toEqual([{ threadId: "t1", lastPromptedAt: 1_700 }]);
  });
});
