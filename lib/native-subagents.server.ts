import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { NativeSubagent, NativeSubagentEntry } from "./native-subagents";

export const nativeSubagentEntrySchema = z.object({
  threadId: z.string(),
  agents: z.array(z.object({
    id: z.string(), label: z.string(),
    status: z.enum(["pending", "completed", "error", "interrupted"]),
    startedAt: z.number(), depth: z.number().int().nonnegative(),
  })),
});

type Threads = BbPluginApi["sdk"]["threads"];
type Event = Awaited<ReturnType<Threads["events"]["list"]>>[number];
type Row = Awaited<ReturnType<Threads["timeline"]>>["rows"][number];
interface TrackedAgent { agent: NativeSubagent; itemId: string; startSeq: number }
interface State { agents: Map<string, TrackedAgent>; sequence: number }
const MAX_PARENTS = 100;
const MAX_AGENTS = 100;
const EVENT_TYPES = ["item/started", "item/completed", "item/delegation/progress", "item/delegation/completed", "system/thread/interrupted"] as const;

function remember(state: State, tracked: TrackedAgent) {
  const previous = state.agents.get(tracked.agent.id);
  // Finishing an earlier call must not mark a follow-up to the same agent done.
  if (previous && previous.itemId !== tracked.itemId && previous.startSeq > tracked.startSeq) return;
  state.agents.set(tracked.agent.id, tracked);
  if (state.agents.size > MAX_AGENTS) {
    const oldest = [...state.agents.values()].sort((a, b) =>
      Number(a.agent.status === "pending") - Number(b.agent.status === "pending") || a.startSeq - b.startSeq)[0]!;
    state.agents.delete(oldest.agent.id);
  }
}

function seedRows(state: State, rows: readonly Row[], depth = 0) {
  for (const row of rows) {
    if (row.kind !== "work" || row.workKind !== "delegation") continue;
    if (row.childRef !== null) remember(state, {
      agent: {
        id: row.childRef,
        label: row.description ?? row.presentation?.title ?? row.subagentType ?? "Subagent",
        status: row.status, startedAt: row.startedAt, depth,
      },
      itemId: row.callId, startSeq: row.sourceSeqStart,
    });
    seedRows(state, row.childRows, depth + 1);
  }
}

function apply(state: State, events: readonly Event[]) {
  for (const event of events) {
    if (event.seq <= state.sequence) continue;
    state.sequence = event.seq;
    if (event.type === "system/thread/interrupted") {
      for (const tracked of state.agents.values()) {
        if (tracked.agent.status === "pending") tracked.agent = { ...tracked.agent, status: "interrupted" };
      }
      continue;
    }
    const data = event.data as { item?: { type?: string; id?: string; childRef?: string; label?: string; status?: string } };
    const item = data?.item;
    if (item?.type !== "delegation" || !item.childRef || !item.id) continue;
    if (!["pending", "completed", "error", "interrupted", "failed"].includes(item.status ?? "")) continue;
    const previous = state.agents.get(item.childRef);
    // Completion/progress belongs to the call that started this agent, never
    // to a newer follow-up that happens to share its provider child reference.
    if (event.type !== "item/started" && previous && previous.itemId !== item.id) continue;
    const sameCall = previous?.itemId === item.id;
    remember(state, {
      agent: {
        id: item.childRef, label: item.label ?? previous?.agent.label ?? "Subagent",
        status: item.status === "failed" ? "error" : item.status as NativeSubagent["status"],
        startedAt: sameCall ? previous.agent.startedAt : event.createdAt,
        depth: previous?.agent.depth ?? 0,
      },
      itemId: item.id, startSeq: sameCall ? previous.startSeq : event.seq,
    });
  }
}

function entry(threadId: string, state: State): NativeSubagentEntry {
  return { threadId, agents: [...state.agents.values()].map(value => value.agent)
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)) };
}

/** One current segment to seed a watched parent, then only unseen event tails. */
export function createNativeSubagentsReader(
  threads: Threads,
  publish: (entry: NativeSubagentEntry) => void,
  warn: (message: string) => void,
) {
  const states = new Map<string, State>();
  const pending = new Map<string, Promise<NativeSubagentEntry>>();
  const pulls = new Map<string, Promise<void>>();

  async function update(threadId: string, sequence: number): Promise<void> {
    const state = states.get(threadId);
    if (!state || sequence <= state.sequence) return;
    const previous = pulls.get(threadId) ?? Promise.resolve();
    const pull = previous.then(async () => {
      if (states.get(threadId) !== state) return;
      const before = JSON.stringify(entry(threadId, state).agents);
      // Normal signals contain just a few events. Cap catch-up work as well.
      for (let page = 0; page < 10; page += 1) {
        const rows = await threads.events.list({ threadId, afterSeq: String(state.sequence), limit: "100", order: "asc", types: [...EVENT_TYPES] });
        if (rows.length === 0) { state.sequence = Math.max(state.sequence, sequence); break; }
        apply(state, rows);
        if (rows.length < 100) { state.sequence = Math.max(state.sequence, sequence); break; }
      }
      if (JSON.stringify(entry(threadId, state).agents) !== before) publish(entry(threadId, state));
    }).catch(cause => warn(`Could not follow subagents for ${threadId}: ${cause}`))
      .finally(() => { if (pulls.get(threadId) === pull) pulls.delete(threadId); });
    pulls.set(threadId, pull);
    return pull;
  }

  function read(threadId: string): Promise<NativeSubagentEntry> {
    const known = states.get(threadId);
    if (known) {
      // Touch the LRU so a currently visible parent stays subscribed.
      states.delete(threadId); states.set(threadId, known);
      return Promise.resolve(entry(threadId, known));
    }
    const existing = pending.get(threadId);
    if (existing) return existing;
    const seed = threads.timeline({ threadId, segmentLimit: "1", includeNestedRows: "true" }).then(timeline => {
      const state: State = { agents: new Map(), sequence: timeline.maxSeq };
      seedRows(state, timeline.rows);
      states.set(threadId, state);
      if (states.size > MAX_PARENTS) states.delete(states.keys().next().value!);
      return entry(threadId, state);
    }).finally(() => pending.delete(threadId));
    pending.set(threadId, seed);
    return seed;
  }

  return { read, update };
}
