import { describe, expect, it } from "vitest";
import {
  createThreadHistoryStore,
  EMPTY_THREAD_HISTORY,
  isThreadHistory,
  recordVisit,
  stepHistory,
  THREAD_HISTORY_LIMIT,
  type ThreadHistory,
} from "./thread-history";

function visitAll(threadIds: readonly string[]): ThreadHistory {
  return threadIds.reduce(recordVisit, EMPTY_THREAD_HISTORY);
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("thread history", () => {
  it("appends visits in order and ignores a repeat of the current thread", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_b", "thr_c"]);
    expect(history.entries).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(history.index).toBe(2);
  });

  it("steps back and forward without changing entries", () => {
    const history = visitAll(["thr_a", "thr_b", "thr_c"]);
    const back = stepHistory(history, -1);
    expect(back?.threadId).toBe("thr_b");
    const backAgain = stepHistory(back!.history, -1);
    expect(backAgain?.threadId).toBe("thr_a");
    expect(stepHistory(backAgain!.history, -1)).toBeNull();
    expect(stepHistory(backAgain!.history, 1)?.threadId).toBe("thr_b");
    expect(stepHistory(history, 1)).toBeNull();
    expect(stepHistory(EMPTY_THREAD_HISTORY, -1)).toBeNull();
  });

  it("drops forward entries when a new thread is opened after going back", () => {
    const back = stepHistory(visitAll(["thr_a", "thr_b", "thr_c"]), -1)!.history;
    const branched = recordVisit(back, "thr_d");
    expect(branched.entries).toEqual(["thr_a", "thr_b", "thr_d"]);
    expect(stepHistory(branched, 1)).toBeNull();
  });

  it("keeps the cursor when arriving at the thread it already points to", () => {
    const back = stepHistory(visitAll(["thr_a", "thr_b"]), -1)!.history;
    expect(recordVisit(back, "thr_a")).toBe(back);
  });

  it("caps the history by dropping the oldest entries", () => {
    const ids = Array.from(
      { length: THREAD_HISTORY_LIMIT + 3 },
      (_, index) => `thr_${index}`,
    );
    const history = visitAll(ids);
    expect(history.entries).toHaveLength(THREAD_HISTORY_LIMIT);
    expect(history.entries[0]).toBe("thr_3");
    expect(history.index).toBe(THREAD_HISTORY_LIMIT - 1);
  });

  it("validates persisted shapes", () => {
    expect(isThreadHistory(visitAll(["thr_a"]))).toBe(true);
    expect(isThreadHistory(EMPTY_THREAD_HISTORY)).toBe(true);
    expect(isThreadHistory({ entries: ["thr_a"], index: 1 })).toBe(false);
    expect(isThreadHistory({ entries: [""], index: 0 })).toBe(false);
    expect(isThreadHistory({ entries: [], index: 0 })).toBe(false);
    expect(isThreadHistory("nope")).toBe(false);
  });
});

describe("thread history store", () => {
  it("persists visits and cursor moves to storage", () => {
    const storage = fakeStorage();
    const store = createThreadHistoryStore(storage, "k");
    store.record("thr_a");
    store.record("thr_b");
    expect(store.canStep(-1)).toBe(true);
    expect(store.canStep(1)).toBe(false);
    expect(store.step(-1)).toBe("thr_a");
    expect(store.step(-1)).toBeNull();
    expect(store.step(1)).toBe("thr_b");

    const reopened = createThreadHistoryStore(storage, "k");
    expect(reopened.read()).toEqual({ entries: ["thr_a", "thr_b"], index: 1 });
  });

  it("ignores corrupt storage and works in memory without storage", () => {
    const storage = fakeStorage();
    storage.map.set("k", "{not json");
    expect(createThreadHistoryStore(storage, "k").read()).toEqual(
      EMPTY_THREAD_HISTORY,
    );
    storage.map.set("k", JSON.stringify({ entries: ["thr_a"], index: 5 }));
    expect(createThreadHistoryStore(storage, "k").read()).toEqual(
      EMPTY_THREAD_HISTORY,
    );

    const memoryStore = createThreadHistoryStore(null);
    memoryStore.record("thr_a");
    memoryStore.record("thr_b");
    expect(memoryStore.step(-1)).toBe("thr_a");
  });
});
