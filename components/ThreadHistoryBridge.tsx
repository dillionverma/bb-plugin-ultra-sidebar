import { useEffect } from "react";
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { createThreadHistoryStore } from "@/lib/thread-history";

const store = createThreadHistoryStore(
  typeof window === "undefined" ? null : window.sessionStorage,
);

let navigateToThread: ((threadId: string) => void) | null = null;

export function canStepThreadHistory(offset: -1 | 1): boolean {
  return store.canStep(offset);
}

export function stepThreadHistory(offset: -1 | 1): boolean {
  if (navigateToThread === null || !store.canStep(offset)) return false;
  const threadId = store.step(offset);
  if (threadId === null) return false;
  navigateToThread(threadId);
  return true;
}

export function ThreadHistoryBridge() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();

  useEffect(() => {
    const toThread = (id: string) => navigate.toThread(id);
    navigateToThread = toThread;
    return () => {
      if (navigateToThread === toThread) navigateToThread = null;
    };
  }, [navigate]);

  useEffect(() => {
    if (threadId) store.record(threadId);
  }, [threadId]);

  return null;
}
