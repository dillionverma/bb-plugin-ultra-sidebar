export const THREAD_HISTORY_LIMIT = 50;
const THREAD_HISTORY_STORAGE_KEY = "bb-workspace-sidebar:thread-history:v1";

export interface ThreadHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

export const EMPTY_THREAD_HISTORY: ThreadHistory = { entries: [], index: -1 };

export function isThreadHistory(value: unknown): value is ThreadHistory {
  if (typeof value !== "object" || value === null) return false;
  const { entries, index } = value as { entries?: unknown; index?: unknown };
  return (
    Array.isArray(entries) &&
    entries.length <= THREAD_HISTORY_LIMIT &&
    entries.every((entry) => typeof entry === "string" && entry.length > 0) &&
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= -1 &&
    index < entries.length
  );
}

function currentThreadId(history: ThreadHistory): string | null {
  return history.entries[history.index] ?? null;
}

export function recordVisit(
  history: ThreadHistory,
  threadId: string,
): ThreadHistory {
  if (currentThreadId(history) === threadId) return history;
  const entries = [...history.entries.slice(0, history.index + 1), threadId].slice(
    -THREAD_HISTORY_LIMIT,
  );
  return { entries, index: entries.length - 1 };
}

export function stepHistory(
  history: ThreadHistory,
  offset: -1 | 1,
): { history: ThreadHistory; threadId: string } | null {
  const index = history.index + offset;
  const threadId = history.entries[index];
  if (threadId === undefined) return null;
  return { history: { entries: history.entries, index }, threadId };
}

export type ThreadHistoryStorage = Pick<Storage, "getItem" | "setItem">;

export interface ThreadHistoryStore {
  read(): ThreadHistory;
  record(threadId: string): void;
  canStep(offset: -1 | 1): boolean;
  step(offset: -1 | 1): string | null;
}

export function createThreadHistoryStore(
  storage: ThreadHistoryStorage | null,
  key = THREAD_HISTORY_STORAGE_KEY,
): ThreadHistoryStore {
  let memory: ThreadHistory = EMPTY_THREAD_HISTORY;

  const read = (): ThreadHistory => {
    if (!storage) return memory;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
      return isThreadHistory(parsed) ? parsed : EMPTY_THREAD_HISTORY;
    } catch {
      return EMPTY_THREAD_HISTORY;
    }
  };

  const write = (history: ThreadHistory) => {
    memory = history;
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(history));
    } catch {
      return;
    }
  };

  return {
    read,
    record(threadId) {
      const before = read();
      const after = recordVisit(before, threadId);
      if (after !== before) write(after);
    },
    canStep(offset) {
      return stepHistory(read(), offset) !== null;
    },
    step(offset) {
      const next = stepHistory(read(), offset);
      if (!next) return null;
      write(next.history);
      return next.threadId;
    },
  };
}
