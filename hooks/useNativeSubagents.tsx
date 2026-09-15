// The agents a thread runs inside itself — a provider's own Task/subagent
// calls — which have no BB thread and so never appear in the host's thread
// list. Without this the sidebar simply loses them mid-run.
//
// Rows say which parents they care about; the provider batches those ids into
// one RPC and then follows the server's pushes on the NATIVE_SUBAGENTS
// channel. A parent keeps its last known list after nobody watches it any
// more, so finished agents stay put while the sidebar is open.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  NATIVE_SUBAGENTS,
  type NativeSubagent,
  type NativeSubagentEntry,
} from "../lib/native-subagents";

const NONE: readonly NativeSubagent[] = [];

type Entries = ReadonlyMap<string, readonly NativeSubagent[]>;

const EMPTY: Entries = new Map();

/** The contract's per-call ceiling. */
const BATCH_SIZE = 100;

interface NativeSubagentsValue {
  entries: Entries;
  /** Follow a parent thread until the returned function is called. */
  watch(threadId: string): () => void;
}

const NativeSubagentsContext = createContext<NativeSubagentsValue | null>(null);

function isEntry(payload: unknown): payload is NativeSubagentEntry {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { threadId?: unknown }).threadId === "string" &&
    Array.isArray((payload as { agents?: unknown }).agents)
  );
}

export function NativeSubagentsProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [entries, setEntries] = useState<Entries>(EMPTY);
  // Ref-counted: the same parent is watched by its row and by its subtree.
  const watchers = useRef(new Map<string, number>());
  const [watchKey, setWatchKey] = useState("");

  const watch = useCallback((threadId: string) => {
    const resync = () =>
      setWatchKey([...watchers.current.keys()].sort().join(","));
    watchers.current.set(threadId, (watchers.current.get(threadId) ?? 0) + 1);
    resync();
    return () => {
      const left = (watchers.current.get(threadId) ?? 1) - 1;
      if (left > 0) watchers.current.set(threadId, left);
      else watchers.current.delete(threadId);
      resync();
    };
  }, []);

  useRealtime(NATIVE_SUBAGENTS, (payload) => {
    if (!isEntry(payload)) return;
    setEntries((current) => {
      const next = new Map(current);
      next.set(payload.threadId, payload.agents);
      return next;
    });
  });

  // Seed whenever the watched set changes and again after a reconnect:
  // pushes are ephemeral, so anything missed while offline is gone.
  useEffect(() => {
    if (watchKey === "" || connection !== "connected") return;
    const ids = watchKey.split(",");
    const batches: string[][] = [];
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      batches.push(ids.slice(start, start + BATCH_SIZE));
    }
    let cancelled = false;
    Promise.all(
      batches.map((threadIds) =>
        rpc.call("threads.nativeSubagents", { threadIds }),
      ),
    ).then(
      (results) => {
        if (cancelled) return;
        setEntries((current) => {
          const next = new Map(current);
          for (const result of results) {
            for (const entry of result.entries) {
              next.set(entry.threadId, entry.agents);
            }
          }
          return next;
        });
      },
      () => {
        // A failed seed leaves the rows as they were; the next push fixes it.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, watchKey, connection]);

  const value = useMemo<NativeSubagentsValue>(
    () => ({ entries, watch }),
    [entries, watch],
  );
  return (
    <NativeSubagentsContext.Provider value={value}>
      {children}
    </NativeSubagentsContext.Provider>
  );
}

/**
 * The agents running inside a thread. `enabled` keeps the ask to parents
 * worth following — one that is delegating right now, or one somebody has
 * expanded — so an idle sidebar costs nothing.
 */
export function useNativeSubagents(
  threadId: string,
  enabled = true,
): readonly NativeSubagent[] {
  const context = useContext(NativeSubagentsContext);
  const watch = context?.watch;
  useEffect(() => {
    if (!enabled || watch === undefined) return;
    return watch(threadId);
  }, [watch, threadId, enabled]);
  // Outside a provider (isolated row tests) there is simply nothing to show.
  return context?.entries.get(threadId) ?? NONE;
}
