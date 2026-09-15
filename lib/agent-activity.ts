// What an agent is doing right now, folded out of its thread event log.
//
// bb's indicator says a thread is "working"; this says what kind of work:
// thinking, running a command, editing a file, searching the web. It is a
// pure reducer over the event stream so the server can keep one small state
// per live thread and the client only ever sees the answer.
//
// Shared by server.ts (reduction) and the app (types), so it must stay free
// of node and react imports.

export type AgentActivityKind =
  | "starting"
  | "thinking"
  | "writing"
  | "command"
  | "editing"
  | "reading"
  | "searching"
  | "web-search"
  | "web-fetch"
  | "tool"
  | "delegating"
  | "background"
  | "planning"
  | "compacting"
  | "image"
  | "working";

export interface AgentActivity {
  kind: AgentActivityKind;
  /** Two or three words for the row: "Running grep", "Editing app.tsx". */
  label: string;
  /** The full fact for a tooltip: the command, the path, the query. */
  detail: string;
  /** The event sequence this was derived from, for ordering updates. */
  seq: number;
  at: number;
}

/** The realtime channel a changed activity is published on. */
export const AGENT_ACTIVITY = "agent-activity";

export interface AgentActivityUpdate {
  threadId: string;
  activity: AgentActivity | null;
}

/** The slice of an event row this reducer reads. Kept loose on purpose: bb
 * adds item kinds over time and an unknown one must fold to "Working", not
 * throw. */
export interface AgentEvent {
  type: string;
  seq: number;
  createdAt: number;
  data?: unknown;
}

interface OpenItem {
  activity: AgentActivity;
  /** Background tasks outlive the item that spawned them, so they only
   * describe the thread when nothing foreground is open. */
  background: boolean;
}

export interface AgentActivityState {
  /** Items started and not yet completed, in start order. */
  open: Map<string, OpenItem>;
  inTurn: boolean;
  lastSeq: number;
  current: AgentActivity | null;
}

export function initialAgentActivityState(): AgentActivityState {
  return { open: new Map(), inTurn: false, lastSeq: 0, current: null };
}

/** The event types the reducer cares about; anything else is skipped. */
export const AGENT_EVENT_TYPES = [
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/backgroundTask/completed",
] as const;

const MAX_DETAIL = 160;

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL
    ? `${oneLine.slice(0, MAX_DETAIL - 1)}…`
    : oneLine;
}

/**
 * The program a shell command runs, for "Running grep". Skips `cd x &&`,
 * env assignments and sudo, and takes the basename so `/usr/bin/env` reads as
 * `env`.
 */
export function commandProgram(command: string): string | null {
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const segment of segments) {
    const words = segment.trim().split(/\s+/).filter((w) => w !== "");
    let index = 0;
    while (index < words.length) {
      const word = words[index]!;
      if (word === "cd" || word === "sudo" || word === "exec" || word === "time") {
        index += word === "cd" ? 2 : 1;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        index += 1;
        continue;
      }
      break;
    }
    const program = words[index];
    if (program === undefined) continue;
    const name = basename(program.replace(/^["']|["']$/g, ""));
    if (name !== "") return name;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * One item, described. Returns null for items that are not the agent doing
 * something (a user message, an unknown shape).
 */
export function describeItem(
  item: Record<string, unknown>,
  seq: number,
  at: number,
): OpenItem | null {
  const kind = str(item.type);
  if (kind === null) return null;
  const make = (
    activity: Omit<AgentActivity, "seq" | "at">,
    background = false,
  ): OpenItem => ({ activity: { ...activity, seq, at }, background });

  switch (kind) {
    case "userMessage":
      return null;
    case "reasoning":
      return make({ kind: "thinking", label: "Thinking", detail: "Thinking" });
    case "agentMessage":
      return make({ kind: "writing", label: "Writing", detail: "Writing a reply" });
    case "commandExecution": {
      const command = str(item.command) ?? "";
      const program = commandProgram(command);
      return make({
        kind: "command",
        label: program === null ? "Running command" : `Running ${program}`,
        detail: clip(command) || "Running a command",
      });
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .map((change) =>
          typeof change === "object" && change !== null
            ? str((change as Record<string, unknown>).path)
            : null,
        )
        .filter((path): path is string => path !== null);
      const first = paths[0];
      const extra = paths.length > 1 ? ` +${paths.length - 1}` : "";
      return make({
        kind: "editing",
        label: first === undefined ? "Editing files" : `Editing ${basename(first)}${extra}`,
        detail: paths.length === 0 ? "Editing files" : clip(paths.join(", ")),
      });
    }
    case "fileRead": {
      const path = str(item.path);
      return make({
        kind: "reading",
        label: path === null ? "Reading file" : `Reading ${basename(path)}`,
        detail: path === null ? "Reading a file" : clip(path),
      });
    }
    case "imageView":
      return make({ kind: "reading", label: "Viewing image", detail: clip(str(item.path) ?? "Viewing an image") });
    case "search": {
      const query = str(item.query);
      const mode = str(item.mode);
      const label = mode === "list" ? "Listing files" : mode === "path" ? "Finding files" : "Searching code";
      return make({
        kind: "searching",
        label,
        detail: query === null ? label : clip(query),
      });
    }
    case "webSearch": {
      const queries = Array.isArray(item.queries)
        ? item.queries.filter((q): q is string => typeof q === "string")
        : [];
      return make({
        kind: "web-search",
        label: "Searching the web",
        detail: queries.length === 0 ? "Searching the web" : clip(queries.join(" · ")),
      });
    }
    case "webFetch": {
      const url = str(item.url);
      return make({
        kind: "web-fetch",
        label: url === null ? "Fetching page" : `Fetching ${hostOf(url)}`,
        detail: url === null ? "Fetching a page" : clip(url),
      });
    }
    case "toolCall": {
      const tool = str(item.tool);
      const server = str(item.server);
      return make({
        kind: "tool",
        label: tool === null ? "Calling tool" : `Calling ${tool}`,
        detail:
          tool === null
            ? "Calling a tool"
            : server === null
              ? `Calling ${tool}`
              : `Calling ${tool} on ${server}`,
      });
    }
    case "delegation": {
      const label = str(item.label);
      return make({
        kind: "delegating",
        label: "Delegating",
        detail: label === null ? "Delegating to a subagent" : clip(label),
      });
    }
    case "backgroundTask": {
      const description = str(item.description) ?? str(item.summary);
      return make(
        {
          kind: "background",
          label: "Background task",
          detail: description === null ? "A background task is running" : clip(description),
        },
        true,
      );
    }
    case "plan":
    case "planSteps":
      return make({ kind: "planning", label: "Planning", detail: "Writing a plan" });
    case "contextCompaction":
      return make({ kind: "compacting", label: "Compacting", detail: "Compacting context" });
    case "imageGeneration":
      return make({ kind: "image", label: "Generating image", detail: clip(str(item.prompt) ?? "Generating an image") });
    case "extension": {
      const name = str(item.kind);
      return make({ kind: "working", label: "Working", detail: name === null ? "Working" : clip(name) });
    }
    default:
      return make({ kind: "working", label: "Working", detail: kind });
  }
}

/** The newest foreground item, else the newest background one, else null. */
function resolveCurrent(state: AgentActivityState, seq: number, at: number): AgentActivity | null {
  if (!state.inTurn) return null;
  let foreground: OpenItem | null = null;
  let background: OpenItem | null = null;
  for (const open of state.open.values()) {
    if (open.background) background = open;
    else foreground = open;
  }
  const chosen = foreground ?? background;
  if (chosen !== null) return chosen.activity;
  // Between items the model is producing its next step, which from the
  // outside is indistinguishable from thinking.
  return { kind: "thinking", label: "Thinking", detail: "Thinking", seq, at };
}

function itemOf(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) return null;
  const item = (data as { item?: unknown }).item;
  return typeof item === "object" && item !== null
    ? (item as Record<string, unknown>)
    : null;
}

function itemIdOf(data: unknown): string | null {
  const item = itemOf(data);
  if (item !== null) return str(item.id);
  if (typeof data === "object" && data !== null) {
    return str((data as { itemId?: unknown }).itemId);
  }
  return null;
}

/**
 * Fold one event in. Mutates `state`; returns true when `current` changed so
 * the caller knows whether there is something to publish.
 */
export function applyAgentEvent(state: AgentActivityState, event: AgentEvent): boolean {
  if (event.seq <= state.lastSeq) return false;
  state.lastSeq = event.seq;
  const before = state.current;

  switch (event.type) {
    case "turn/started":
      state.open.clear();
      state.inTurn = true;
      state.current = {
        kind: "starting",
        label: "Starting",
        detail: "Starting a turn",
        seq: event.seq,
        at: event.createdAt,
      };
      break;
    case "turn/completed":
      state.open.clear();
      state.inTurn = false;
      state.current = null;
      break;
    case "item/started": {
      const item = itemOf(event.data);
      const id = item === null ? null : str(item.id);
      if (item === null || id === null) break;
      // A turn can begin with an item before the turn event lands, and a
      // resumed tail may have no turn/started at all: an item is proof of a
      // turn.
      state.inTurn = true;
      const described = describeItem(item, event.seq, event.createdAt);
      if (described === null) break;
      // Re-insert so Map order is start order even on a restart.
      state.open.delete(id);
      state.open.set(id, described);
      state.current = resolveCurrent(state, event.seq, event.createdAt);
      break;
    }
    case "item/completed":
    case "item/backgroundTask/completed": {
      const id = itemIdOf(event.data);
      if (id !== null) state.open.delete(id);
      state.current = resolveCurrent(state, event.seq, event.createdAt);
      break;
    }
    default:
      return false;
  }

  return !sameActivity(before, state.current);
}

export function sameActivity(a: AgentActivity | null, b: AgentActivity | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.label === b.label && a.detail === b.detail;
}

/** Reduce a batch, in order. Returns true if `current` changed at all. */
export function applyAgentEvents(
  state: AgentActivityState,
  events: readonly AgentEvent[],
): boolean {
  const before = state.current;
  for (const event of events) applyAgentEvent(state, event);
  return !sameActivity(before, state.current);
}
