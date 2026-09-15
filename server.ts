// bb-plugin-workspace-sidebar — backend entry.
//
// Owns the workspace grouping: which projects and threads belong to which
// user-defined workspace, and in what order. bb's own projects and threads are
// never mutated for grouping, so uninstalling this plugin loses the grouping
// and nothing else.
//
// Three surfaces share one store: the replaced sidebar (app.tsx, over RPC),
// the `bb workspace` CLI, and the skill in skills/workspaces/SKILL.md. Every
// write goes through Store.withWrite, which bumps a revision and publishes a
// realtime signal, so a change from any surface reaches every open window.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createStore, MIGRATIONS, type Store } from "./lib/store.server";
import { placeItem, toPlacement, type DropSide } from "./lib/order";
import {
  WORKSPACES_CHANGED,
  type ItemKind,
  type Placement,
  type Workspace,
} from "./lib/types";
import { isManualStatus } from "./lib/status";
import {
  AGENT_ACTIVITY,
  AGENT_EVENT_TYPES,
  applyAgentEvents,
  initialAgentActivityState,
  type AgentActivityState,
} from "./lib/agent-activity";


import { summarizeQueue } from "./lib/thread-queue";
import { createScheduledTasksActions, createScheduledTasksReader, scheduledTaskRefSchema, scheduledTasksResultSchema } from "./lib/scheduled-tasks.server";
import { createThreadDiffReader, threadDiffSchema } from "./lib/thread-diffs.server";
import { ProjectIconCache } from "./lib/project-artwork-cache";
import { findProjectArtwork, type ProjectArtwork } from "./lib/project-artwork.server";

const itemKindSchema = z.enum(["project", "thread"]);
const sortModeSchema = z.enum(["recent", "manual"]);

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortIndex: z.number().int(),
  sortMode: sortModeSchema,
  createdAt: z.number().int(),
});

const assignmentSchema = z.object({
  kind: itemKindSchema,
  refId: z.string(),
  // null means an explicit detach: pin to Unassigned rather than inherit.
  workspaceId: z.string().nullable(),
  sortIndex: z.number().int(),
});

// Every method answers with the whole state. It is tens to low hundreds of
// rows, it saves a refetch after each write, and it lets the client use one
// reconcile path for reads, writes and realtime alike.
const manualStatusSchema = z.enum(["backlog", "done", "canceled"]);

const lifecycleSchema = z.object({
  threadId: z.string(),
  status: manualStatusSchema.nullable(),
  snoozedUntil: z.number().int().nullable(),
});

const stateSchema = z.object({
  revision: z.number().int(),
  workspaces: z.array(workspaceSchema),
  assignments: z.array(assignmentSchema),
  lifecycle: z.array(lifecycleSchema),
});

const placementSchema = z.object({
  kind: itemKindSchema,
  refId: z.string(),
  workspaceId: z.string().nullable(),
});

const itemRefSchema = z.object({
  kind: itemKindSchema,
  refId: z.string(),
});

const pullRequestSchema = z.object({
  threadId: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "draft", "merged", "closed"]),
  attention: z.string(),
  checksState: z.string().nullable(),
  failedChecks: z.number().int(),
});

// Every field is nullable: a thread that has never run, or one whose provider
// declines to answer, still has to produce a row rather than fail the batch.
const executionSchema = z.object({
  threadId: z.string(),
  model: z.string().nullable(),
  permissionMode: z.string().nullable(),
  reasoningLevel: z.string().nullable(),
  serviceTier: z.string().nullable(),
});

// Where an environment's checkout lives. The sidebar payload names the branch
// but not the directory, and the directory is what a folder link needs.
const locationSchema = z.object({
  environmentId: z.string(),
  path: z.string(),
  hostId: z.string(),
  hostName: z.string().nullable(),
});

const openFolderResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("opened"), path: z.string() }),
  // The folder exists on another enrolled machine; nothing here can show it.
  z.object({
    outcome: z.literal("remote"),
    path: z.string(),
    hostName: z.string().nullable(),
  }),
]);

// What a live agent is doing right now, folded out of its event log. `kind`
// is a string on the wire so a new kind never fails validation on an older
// client; the app narrows it.
const agentActivitySchema = z.object({
  threadId: z.string(),
  activity: z.object({
    kind: z.string(),
    label: z.string(),
    detail: z.string(),
    seq: z.number().int(),
    at: z.number().int(),
  }),
});

export const rpcContract = defineRpcContract({
  "threads.plan": {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ plan: z.object({
      mode: z.literal("plan"),
      prompt: z.string(),
      providerId: z.string(),
    }).nullable() }),
  },
  "threads.diffs": {
    input: z.object({ threads: z.array(z.object({ threadId: z.string(), environmentId: z.string() })).min(1).max(300) }),
    output: z.object({ entries: z.array(threadDiffSchema) }),
  },
  "threads.goal": {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ goal: z.object({
      objective: z.string(),
      status: z.enum(["active", "budgetLimited", "complete", "paused"]),
      timeUsedSeconds: z.number(),
      tokenBudget: z.number().nullable(),
      tokensUsed: z.number(),
      updatedAt: z.number(),
    }).nullable() }),
  },
  "scheduledTasks.list": {
    input: z.null(),
    output: scheduledTasksResultSchema,
  },
  /** Start an automation now, outside its schedule. */
  "scheduledTasks.run": {
    input: scheduledTaskRefSchema,
    output: z.object({ ok: z.literal(true) }),
  },
  /** Pause (false) or resume (true) an automation's schedule. */
  "scheduledTasks.setEnabled": {
    input: scheduledTaskRefSchema.extend({ enabled: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * The current activity of each thread asked about, for the rows that are
   * live. Threads with nothing to say are simply absent. Asking is also what
   * starts the server tracking a thread; updates then arrive on the
   * AGENT_ACTIVITY realtime channel.
   */
  "threads.agentActivity": {
    input: z.object({ threadIds: z.array(z.string()).min(1).max(300) }),
    output: z.object({ entries: z.array(agentActivitySchema) }),
  },
  "workspaces.state": { input: z.null(), output: stateSchema },
  /** Checkout directories for a batch of environments; unknown ids are skipped. */
  "environments.locations": {
    input: z.object({
      environmentIds: z.array(z.string()).min(1).max(300),
    }),
    output: z.object({ entries: z.array(locationSchema) }),
  },
  /**
   * Reveal an environment's folder in the file manager of the machine bb runs
   * on. A checkout on another host is reported rather than opened.
   */
  "environments.openFolder": {
    input: z.object({ environmentId: z.string() }),
    output: openFolderResultSchema,
  },
  "workspaces.edit": {
    input: z.object({
      before: stateSchema.extend({
        workspaces: z.array(workspaceSchema).max(200),
        assignments: z.array(assignmentSchema).max(5000),
        lifecycle: z.array(lifecycleSchema).max(10000),
      }),
      after: stateSchema.extend({
        workspaces: z
          .array(
            workspaceSchema.extend({ name: z.string().trim().min(1).max(60) }),
          )
          .max(200),
        assignments: z.array(assignmentSchema).max(5000),
        lifecycle: z.array(lifecycleSchema).max(10000),
      }),
    }),
    output: stateSchema,
  },
  "threads.title": {
    input: z.object({ threadId: z.string() }),
    output: z.string().nullable(),
  },
  "threads.restoreTitle": {
    input: z.object({
      threadId: z.string(),
      expected: z.string().nullable(),
      title: z.string().nullable(),
    }),
    output: z.null(),
  },
  /** Re-submit the failed turn; "sent" ran now, "queued" waits its turn. */
  "threads.handoffOptions": {
    input: z.object({ threadId: z.string().min(1), providerId: z.string().min(1).optional() }),
    output: z.object({
      providerId: z.string(),
      providers: z.array(z.object({ id: z.string(), name: z.string(), available: z.boolean() })),
      models: z.array(z.object({ id: z.string(), name: z.string() })),
      error: z.string().nullable(),
    }),
  },
  "threads.handoff": {
    input: z.object({ threadId: z.string().min(1), workspaceId: z.string().nullable(), target: z.object({ providerId: z.string().min(1), model: z.string().min(1) }).optional() }),
    output: z.object({ threadId: z.string() }),
  },
  "threads.retry": {
    input: z.object({ threadId: z.string() }),
    output: z.object({ delivery: z.enum(["sent", "queued"]) }),
  },
  "workspaces.create": {
    input: z.object({ name: z.string().trim().min(1).max(60) }),
    output: z.object({ workspace: workspaceSchema, state: stateSchema }),
  },
  "workspaces.rename": {
    input: z.object({ id: z.string(), name: z.string().trim().min(1).max(60) }),
    output: stateSchema,
  },
  "workspaces.remove": {
    input: z.object({
      id: z.string(),
      // "detach" drops the rows so members fall back to inheriting; a
      // workspace id moves them there instead.
      reassign: z.string().default("detach"),
    }),
    output: stateSchema,
  },
  "workspaces.reorder": {
    input: z.object({ orderedIds: z.array(z.string()).max(200) }),
    output: stateSchema,
  },
  "workspaces.setSortMode": {
    input: z.object({ id: z.string(), sortMode: sortModeSchema }),
    output: stateSchema,
  },
  // One drop is one call: the client sends the complete post-drop list, so a
  // move and a reorder are the same operation and retrying is harmless.
  "assignments.place": {
    input: z.object({ placements: z.array(placementSchema).max(5000) }),
    output: stateSchema,
  },
  // Delete the row entirely -> the item goes back to inheriting. Distinct from
  // placing it with workspaceId: null, which pins it to Unassigned.
  "assignments.clear": {
    input: z.object({ items: z.array(itemRefSchema).min(1).max(500) }),
    output: stateSchema,
  },
  /**
   * File threads in Backlog, Done or Canceled by hand. null puts a thread
   * back in the hands of its own facts (its pull request, else In progress).
   */
  "lifecycle.setStatus": {
    input: z.object({
      threadIds: z.array(z.string()).min(1).max(500),
      status: manualStatusSchema.nullable(),
    }),
    output: stateSchema,
  },
  /** Hide a thread until a timestamp; null wakes it immediately. */
  "lifecycle.snooze": {
    input: z.object({
      threadId: z.string(),
      until: z.number().int().nullable(),
    }),
    output: stateSchema,
  },
  /**
   * Pull-request state for a batch of environments.
   *
   * The frontend hook for this is per-row and hits the git host once per
   * thread, which is too much for a sidebar that wants to label every row.
   * Batching it here makes one sidebar paint one request, with a TTL cache
   * absorbing repeats.
   */
  "threads.pullRequests": {
    input: z.object({
      threads: z
        .array(z.object({ threadId: z.string(), environmentId: z.string() }))
        .min(1)
        .max(300),
    }),
    output: z.object({ entries: z.array(pullRequestSchema) }),
  },
  /**
   * The model a thread runs on is deliberately not in the sidebar payload —
   * it only exists behind bb.sdk.threads.defaultExecutionOptions, which is
   * server-side. Batched so one sidebar paint is one request.
   */
  "threads.queueSummary": {
    input: z.object({}),
    output: z.object({ entries: z.array(z.object({
      threadId: z.string(), count: z.number(), sendAt: z.number().nullable(),
      retry: z.boolean(), failed: z.boolean(),
    })) }),
  },
  "threads.execution": {
    input: z.object({ threadIds: z.array(z.string()).min(1).max(300) }),
    output: z.object({ entries: z.array(executionSchema) }),
  },
  /**
   * Each project's artwork: a BB glyph its package.json names, rendered to
   * SVG here, or "image" when an icon or logo file was found — the bytes
   * themselves come from the /project-icon HTTP route so the browser can
   * cache them. Every project asked about gets an entry.
   */
  "projects.artwork": {
    input: z.object({ projectIds: z.array(z.string().min(1)).min(1).max(300) }),
    output: z.object({
      entries: z.array(
        z.discriminatedUnion("kind", [
          z.object({ projectId: z.string(), kind: z.literal("glyph"), svg: z.string() }),
          z.object({ projectId: z.string(), kind: z.literal("image") }),
          z.object({ projectId: z.string(), kind: z.literal("missing") }),
        ]),
      ),
    }),
  },
});

function formatWorkspace(workspace: Workspace, memberCount: number): string {
  return `${workspace.id}  ${workspace.name}  (${memberCount} item${
    memberCount === 1 ? "" : "s"
  }, ${workspace.sortMode})`;
}

export default async function plugin(bb: BbPluginApi) {
  const scheduledTasks = createScheduledTasksReader(bb.sdk.plugins);
  const scheduledTaskActions = createScheduledTasksActions(bb.sdk.plugins, scheduledTasks.invalidate);
  const readThreadDiffs = createThreadDiffReader(bb.sdk.environments);
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const store: Store = createStore(
    db,
    (revision) => {
      bb.realtime.publish(WORKSPACES_CHANGED, { revision });
    },
    () => `ws_${randomUUID().slice(0, 8)}`,
  );

  // ---- agent activity ----------------------------------------------------
  //
  // One reducer state per thread somebody has asked about. The host's
  // per-thread event signal (debounced to once a second) says "new events up
  // to seq N"; we pull the tail we have not seen and publish only when the
  // resolved verb changed. A thread going idle drops its state, so memory is
  // bounded by the number of threads that were live while a sidebar looked.
  const agentStates = new Map<string, AgentActivityState>();
  const agentBootstraps = new Map<string, Promise<AgentActivityState>>();
  const agentPulls = new Map<string, Promise<void>>();
  // The event API's per-call ceiling.
  const AGENT_PAGE = 100;
  type EventTypes = NonNullable<
    Parameters<typeof bb.sdk.threads.events.list>[0]["types"]
  >;
  const agentEventTypes = AGENT_EVENT_TYPES as unknown as EventTypes;

  function publishAgent(threadId: string, state: AgentActivityState | null) {
    bb.realtime.publish(AGENT_ACTIVITY, {
      threadId,
      activity: state?.current ?? null,
    });
  }

  /** Read everything after the last seen seq into the state. */
  async function pullAgentEvents(
    threadId: string,
    state: AgentActivityState,
  ): Promise<boolean> {
    let changed = false;
    for (let page = 0; page < 20; page += 1) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(state.lastSeq),
        limit: String(AGENT_PAGE),
        order: "asc",
        types: agentEventTypes,
      });
      if (rows.length === 0) break;
      if (applyAgentEvents(state, rows)) changed = true;
      if (rows.length < AGENT_PAGE) break;
    }
    return changed;
  }

  /** The state for a thread, reading its recent tail on first ask. */
  function agentStateFor(threadId: string): Promise<AgentActivityState> {
    const known = agentStates.get(threadId);
    if (known !== undefined) return Promise.resolve(known);
    const pending = agentBootstraps.get(threadId);
    if (pending !== undefined) return pending;
    const bootstrap = (async () => {
      const state = initialAgentActivityState();
      try {
        // The newest page, oldest first. A turn/started inside it resets
        // anything older; without one, whatever is open is still the answer.
        const rows = await bb.sdk.threads.events.list({
          threadId,
          limit: String(AGENT_PAGE),
          order: "desc",
          types: agentEventTypes,
        });
        applyAgentEvents(state, rows.slice().reverse());
      } catch (cause) {
        // Not cached: the next ask tries again rather than sitting on an
        // empty state until the thread goes idle.
        bb.log.warn(`Could not read agent activity for ${threadId}: ${cause}`);
        throw cause;
      }
      agentStates.set(threadId, state);
      return state;
    })().finally(() => agentBootstraps.delete(threadId));
    agentBootstraps.set(threadId, bootstrap);
    return bootstrap;
  }

  bb.events.on("experimental_thread.events", ({ thread, sequence }) => {
    const state = agentStates.get(thread.id);
    // Nobody is looking at this thread; it is bootstrapped when they do.
    if (state === undefined || sequence <= state.lastSeq) return;
    // One pull at a time per thread; a signal that lands mid-pull queues.
    const previous = agentPulls.get(thread.id) ?? Promise.resolve();
    const pull = previous
      .then(async () => {
        if (!agentStates.has(thread.id)) return;
        if (await pullAgentEvents(thread.id, state))
          publishAgent(thread.id, state);
      })
      .catch((cause) => {
        bb.log.warn(
          `Could not follow agent activity for ${thread.id}: ${cause}`,
        );
      })
      .finally(() => {
        if (agentPulls.get(thread.id) === pull) agentPulls.delete(thread.id);
      });
    agentPulls.set(thread.id, pull);
  });

  const forgetAgent = ({ thread }: { thread: { id: string } }) => {
    if (!agentStates.delete(thread.id)) return;
    publishAgent(thread.id, null);
  };
  bb.events.on("thread.idle", forgetAgent);
  bb.events.on("thread.failed", forgetAgent);

  // Artwork discovery is two fuzzy file searches plus a read per candidate,
  // against the project's default checkout. Cached with a TTL so a sidebar
  // that re-mounts (every window, every reload) does not repeat the search.
  const artworkCache = new ProjectIconCache<ProjectArtwork>((projectId, signal) =>
    findProjectArtwork(
      {
        listFiles: (args) => bb.sdk.projects.files(args),
        readFile: (args) => bb.sdk.projects.fileContent(args),
      },
      projectId,
      signal,
    ),
  );
  bb.onDispose(() => artworkCache.dispose());

  async function projectArtworkEntry(projectId: string) {
    try {
      const artwork = await artworkCache.get(projectId);
      if (artwork === null) return { projectId, kind: "missing" as const };
      return artwork.kind === "glyph"
        ? { projectId, kind: "glyph" as const, svg: artwork.svg }
        : { projectId, kind: "image" as const };
    } catch (error) {
      // A project with no checkout on this machine, or one bb cannot read,
      // simply has no artwork. The row keeps its folder icon.
      bb.log.debug(
        `No artwork for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { projectId, kind: "missing" as const };
    }
  }

  bb.http.route("GET", "/project-icon", async (context) => {
    const projectId = context.req.query("projectId")?.trim();
    if (!projectId) return new Response(null, { status: 400 });
    try {
      const artwork = await artworkCache.get(projectId);
      if (artwork === null || artwork.kind !== "image") {
        return new Response(null, {
          status: 404,
          headers: { "cache-control": "private, max-age=60" },
        });
      }
      return new Response(artwork.bytes, {
        headers: {
          "cache-control": "private, max-age=300",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "content-type": artwork.mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      bb.log.debug(
        `Could not serve an icon for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "private, max-age=60" },
      });
    }
  });

  bb.rpc.register(rpcContract, {
    "projects.artwork": async ({ projectIds }) => ({
      entries: await Promise.all([...new Set(projectIds)].map(projectArtworkEntry)),
    }),
    "threads.plan": async ({ threadId }) => ({
      plan: (await bb.sdk.threads.timeline({ threadId, segmentLimit: "1", summaryOnly: "true" })).activePromptMode,
    }),
    "threads.goal": async ({ threadId }) => ({
      goal: (await bb.sdk.threads.timeline({ threadId, segmentLimit: "1", summaryOnly: "true" })).goal,
    }),
    "scheduledTasks.list": () => scheduledTasks.list(),
    "scheduledTasks.run": (ref) => scheduledTaskActions.run(ref),
    "scheduledTasks.setEnabled": (input) => scheduledTaskActions.setEnabled(input),
    "threads.agentActivity": async ({ threadIds }) => {
      const entries: {
        threadId: string;
        activity: NonNullable<AgentActivityState["current"]>;
      }[] = [];
      await Promise.all(
        threadIds.map(async (threadId) => {
          try {
            const state = await agentStateFor(threadId);
            if (state.current !== null) {
              entries.push({ threadId, activity: state.current });
            }
          } catch {
            // Already logged; one unreadable thread must not fail the batch.
          }
        }),
      );
      return { entries };
    },
    "threads.title": async ({ threadId }) =>
      (await bb.sdk.threads.get({ threadId })).title,
    "threads.restoreTitle": async ({ threadId, expected, title }) => {
      const current = await bb.sdk.threads.get({ threadId });
      if (current.title !== expected)
        throw new Error(
          "The thread was renamed elsewhere. Undo was not applied.",
        );
      await bb.sdk.threads.update({ threadId, title });
      return null;
    },
    "threads.handoffOptions": async ({ threadId, providerId }) => {
      const source = await bb.sdk.threads.get({ threadId });
      const routing = source.environmentId ? { environmentId: source.environmentId } : { environmentId: undefined };
      const selected = providerId ?? source.providerId;
      const [providers, catalog] = await Promise.all([
        bb.sdk.providers.list(routing),
        bb.sdk.providers.models({ ...routing, providerId: selected }),
      ]);
      return {
        providerId: selected,
        providers: providers.map(p => ({ id: p.id, name: p.displayName, available: p.available })),
        models: catalog.models.map(m => ({ id: m.model, name: m.displayName })),
        error: catalog.modelLoadError ? `Models unavailable: ${catalog.modelLoadError.code}` : null,
      };
    },
    "threads.handoff": async ({ threadId, workspaceId, target }) => {
      const result = await bb.sdk.plugins.callRpc({
        pluginId: "handoff", method: "handoff", input: { threadId, ...(target ? { target } : {}) },
        outputSchema: z.object({ threadId: z.string() }),
      });
      store.placeAssignments([{ kind: "thread", refId: result.threadId, workspaceId }]);
      return result;
    },
    "threads.retry": async ({ threadId }) => ({
      delivery: (await bb.sdk.threads.retry({ threadId })).delivery,
    }),
    "workspaces.state": () => store.readState(),
    "workspaces.edit": ({ before, after }) => store.edit(before, after),
    "workspaces.create": ({ name }) => store.createWorkspace(name),
    "workspaces.rename": ({ id, name }) => store.renameWorkspace(id, name),
    "workspaces.remove": ({ id, reassign }) =>
      store.removeWorkspace(id, reassign),
    "workspaces.reorder": ({ orderedIds }) =>
      store.reorderWorkspaces(orderedIds),
    "workspaces.setSortMode": ({ id, sortMode }) =>
      store.setSortMode(id, sortMode),
    "assignments.place": ({ placements }) => store.placeAssignments(placements),
    "assignments.clear": ({ items }) => store.clearAssignments(items),
    "lifecycle.setStatus": ({ threadIds, status }) =>
      store.setStatus(threadIds, status),
    "lifecycle.snooze": ({ threadId, until }) =>
      store.setSnoozed(threadId, until),
    "threads.queueSummary": async () => ({ entries: summarizeQueue(await bb.sdk.threads.queue.list()) }),
    "threads.execution": async ({ threadIds }) => ({
      entries: await readExecutionOptions(threadIds),
    }),
    "threads.diffs": async ({ threads }) => ({ entries: await readThreadDiffs(threads) }),
    "threads.pullRequests": async ({ threads }) => ({
      entries: await readPullRequests(threads),
    }),
    "environments.locations": async ({ environmentIds }) => ({
      entries: await readLocations(environmentIds),
    }),
    "environments.openFolder": ({ environmentId }) => openFolder(environmentId),
  });

  // A checkout does not move, so a location is cached for as long as the
  // plugin runs; a deleted environment simply stops being asked about.
  const locationCache = new Map<
    string,
    z.infer<typeof locationSchema> | null
  >();
  const hostNameCache = new Map<string, string | null>();

  async function hostName(hostId: string): Promise<string | null> {
    const cached = hostNameCache.get(hostId);
    if (cached !== undefined) return cached;
    let name: string | null = null;
    try {
      name = (await bb.sdk.hosts.get({ hostId })).name;
    } catch {
      // An unenrolled host still has a folder; it just has no name to show.
    }
    hostNameCache.set(hostId, name);
    return name;
  }

  async function readLocation(
    environmentId: string,
  ): Promise<z.infer<typeof locationSchema> | null> {
    const cached = locationCache.get(environmentId);
    if (cached !== undefined) return cached;
    let value: z.infer<typeof locationSchema> | null = null;
    try {
      const environment = await bb.sdk.environments.get({ environmentId });
      if (environment.path !== null) {
        value = {
          environmentId,
          path: environment.path,
          hostId: environment.hostId,
          hostName: await hostName(environment.hostId),
        };
      }
    } catch {
      // A deleted environment must not take the rest of the batch with it,
      // and must not be remembered as "no folder" either.
      return null;
    }
    locationCache.set(environmentId, value);
    return value;
  }

  async function readLocations(
    environmentIds: string[],
  ): Promise<z.infer<typeof locationSchema>[]> {
    const results = await Promise.all(environmentIds.map(readLocation));
    return results.filter(
      (entry): entry is z.infer<typeof locationSchema> => entry !== null,
    );
  }

  /** The platform's "show me this folder" command. */
  function revealCommand(path: string): { command: string; args: string[] } {
    if (process.platform === "darwin") return { command: "open", args: [path] };
    if (process.platform === "win32") {
      return { command: "explorer", args: [path] };
    }
    return { command: "xdg-open", args: [path] };
  }

  async function openFolder(
    environmentId: string,
  ): Promise<z.infer<typeof openFolderResultSchema>> {
    const location = await readLocation(environmentId);
    if (location === null) {
      throw new Error("This thread has no folder yet");
    }
    // Existence here is the test for "this machine", not the host id: a
    // path that resolves locally can be opened whatever bb calls the host.
    const isLocalDirectory = await stat(location.path).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!isLocalDirectory) {
      return {
        outcome: "remote",
        path: location.path,
        hostName: location.hostName,
      };
    }
    const { command, args } = revealCommand(location.path);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    return { outcome: "opened", path: location.path };
  }

  /**
   * Resolve each thread's model in parallel, degrading per thread.
   *
   * The client only asks for ids whose `updatedAt` it has not seen, so this is
   * event-driven rather than polled; the short TTL just absorbs the burst when
   * several windows paint at once.
   */
  // Keyed by environment: a git-host round trip is the expensive part, and
  // several threads can share one environment.
  const pullRequestCache = new Map<
    string,
    { at: number; value: z.infer<typeof pullRequestSchema> | null }
  >();
  const PULL_REQUEST_TTL_MS = 60_000;

  async function readPullRequests(
    threads: { threadId: string; environmentId: string }[],
  ): Promise<z.infer<typeof pullRequestSchema>[]> {
    const now = Date.now();
    const results = await Promise.all(
      threads.map(async ({ threadId, environmentId }) => {
        const cached = pullRequestCache.get(environmentId);
        if (cached !== undefined && now - cached.at < PULL_REQUEST_TTL_MS) {
          return cached.value === null ? null : { ...cached.value, threadId };
        }
        let value: z.infer<typeof pullRequestSchema> | null = null;
        try {
          const result = await bb.sdk.environments.pullRequest({
            environmentId,
          });
          // The union also carries "absent", "not_applicable" and
          // "unavailable"; only one of them means there is a PR to show.
          if (result.outcome === "available") {
            const pr = result.pullRequest;
            value = {
              threadId,
              number: pr.number,
              title: pr.title,
              url: pr.url,
              state: pr.state,
              attention: pr.attention,
              checksState: pr.checks?.state ?? null,
              failedChecks: pr.checks?.failedCount ?? 0,
            };
          }
        } catch {
          // A git-host hiccup leaves the row without a PR label rather than
          // taking the rest of the batch down.
        }
        pullRequestCache.set(environmentId, { at: now, value });
        return value === null ? null : { ...value, threadId };
      }),
    );
    return results.filter(
      (entry): entry is z.infer<typeof pullRequestSchema> => entry !== null,
    );
  }

  const executionCache = new Map<
    string,
    { at: number; value: z.infer<typeof executionSchema> }
  >();
  const EXECUTION_TTL_MS = 30_000;

  async function readExecutionOptions(
    threadIds: string[],
  ): Promise<z.infer<typeof executionSchema>[]> {
    const now = Date.now();
    return Promise.all(
      threadIds.map(async (threadId) => {
        const cached = executionCache.get(threadId);
        if (cached !== undefined && now - cached.at < EXECUTION_TTL_MS) {
          return cached.value;
        }
        let value: z.infer<typeof executionSchema> = {
          threadId,
          model: null,
          permissionMode: null,
          reasoningLevel: null,
          serviceTier: null,
        };
        try {
          const options = await bb.sdk.threads.defaultExecutionOptions({
            threadId,
          });
          if (options !== null) {
            value = {
              threadId,
              model: options.model,
              permissionMode: options.permissionMode,
              reasoningLevel: options.reasoningLevel,
              serviceTier: options.serviceTier,
            };
          }
        } catch {
          // A thread that has been deleted mid-paint, or a provider that
          // cannot answer, must not take the rest of the batch with it.
        }
        executionCache.set(threadId, { at: now, value });
        return value;
      }),
    );
  }

  // A deleted thread's assignment is dead weight, and a recycled id would
  // inherit its grouping. Archived threads keep theirs — they come back.
  bb.events.on("thread.deleted", ({ thread }) => {
    executionCache.delete(thread.id);
    agentStates.delete(thread.id);
    try {
      store.clearAssignments([{ kind: "thread", refId: thread.id }]);
    } catch (cause) {
      bb.log.warn(`Could not clear assignment for deleted thread: ${cause}`);
    }
  });

  // ---- bb workspace ------------------------------------------------------

  const usage = [
    "Usage:",
    "  bb workspace list [--json]",
    "  bb workspace show <workspace> [--json]",
    "  bb workspace new <name> [--json]",
    "  bb workspace rename <workspace> <new-name> [--json]",
    "  bb workspace rm <workspace> [--move-to <workspace>] [--yes] [--json]",
    "  bb workspace assign <workspace> (--project <id> | --thread <id>)... [--json]",
    "  bb workspace unassign (--project <id> | --thread <id>)... [--json]",
    "  bb workspace detach (--thread <id>)... [--json]",
    "  bb workspace sort <workspace> (recent|manual) [--json]",
    "  bb workspace status (in-progress|backlog|done|canceled) (--thread <id>)... [--json]",
    "",
    "<workspace> is an id, a full name, or an unambiguous name prefix.",
  ].join("\n");

  function countMembers(workspaceId: string): number {
    return store
      .readState()
      .assignments.filter(
        (assignment) => assignment.workspaceId === workspaceId,
      ).length;
  }

  /** Collect repeated --project/--thread flags into item refs. */
  function collectItems(
    args: string[],
  ): { items: { kind: ItemKind; refId: string }[] } | { error: string } {
    const items: { kind: ItemKind; refId: string }[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index];
      if (flag !== "--project" && flag !== "--thread") continue;
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `${flag} needs a value.` };
      }
      items.push({
        kind: flag === "--project" ? "project" : "thread",
        refId: value,
      });
      index += 1;
    }
    if (items.length === 0) {
      return { error: "Pass at least one --project <id> or --thread <id>." };
    }
    return { items };
  }

  /** Append items to a workspace by rewriting the full placement list. */
  function assignItems(
    workspaceId: string | null,
    items: { kind: ItemKind; refId: string }[],
  ): void {
    let placements: Placement[] = store
      .readState()
      .assignments.map(toPlacement);
    for (const item of items) {
      placements = placeItem(placements, item, {
        workspaceId,
        anchorRefId: null,
        side: "after" as DropSide,
      });
    }
    store.placeAssignments(placements);
  }

  bb.cli.register({
    name: "workspace",
    summary: "Group bb projects and threads into sidebar workspaces",
    commands: [
      {
        name: "list",
        summary: "List workspaces",
        usage: "bb workspace list [--json]",
      },
      {
        name: "show",
        summary: "Show one workspace's members",
        usage: "bb workspace show <workspace> [--json]",
      },
      {
        name: "new",
        summary: "Create a workspace",
        usage: "bb workspace new <name>",
      },
      {
        name: "rename",
        summary: "Rename a workspace",
        usage: "bb workspace rename <workspace> <new-name>",
      },
      {
        name: "rm",
        summary: "Delete a workspace",
        usage: "bb workspace rm <workspace> [--move-to <workspace>] [--yes]",
      },
      {
        name: "assign",
        summary: "Put projects or threads in a workspace",
        usage:
          "bb workspace assign <workspace> (--project <id> | --thread <id>)...",
      },
      {
        name: "unassign",
        summary: "Drop an explicit assignment (back to inheriting)",
        usage: "bb workspace unassign (--project <id> | --thread <id>)...",
      },
      {
        name: "detach",
        summary: "Pin a thread to Unassigned, ignoring its project",
        usage: "bb workspace detach (--thread <id>)...",
      },
      {
        name: "sort",
        summary: "Set a workspace's thread ordering",
        usage: "bb workspace sort <workspace> (recent|manual)",
      },
      {
        name: "status",
        summary:
          "File threads in Backlog, Done or Canceled, or back In progress",
        usage:
          "bb workspace status (in-progress|backlog|done|canceled) (--thread <id>)...",
      },
    ],
    run(argv) {
      const json = argv.includes("--json");
      const yes = argv.includes("--yes");
      const rest = argv.filter((arg) => arg !== "--json" && arg !== "--yes");
      const [command, ...args] = rest;
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      const fail = (message: string) => ({ exitCode: 1, stderr: message });

      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };

          case "list": {
            const state = store.readState();
            if (state.workspaces.length === 0) {
              return reply(
                [],
                'No workspaces yet. Create one with "bb workspace new <name>".',
              );
            }
            const counts = new Map<string, number>();
            for (const assignment of state.assignments) {
              if (assignment.workspaceId === null) continue;
              counts.set(
                assignment.workspaceId,
                (counts.get(assignment.workspaceId) ?? 0) + 1,
              );
            }
            return reply(
              state.workspaces,
              state.workspaces
                .slice(0, 200)
                .map((workspace) =>
                  formatWorkspace(workspace, counts.get(workspace.id) ?? 0),
                )
                .join("\n"),
            );
          }

          case "show": {
            const selector = args[0];
            if (selector === undefined) return fail(usage);
            const found = store.findWorkspace(selector);
            if (found === null)
              return fail(`No workspace matching "${selector}".`);
            if ("ambiguous" in found) {
              return fail(
                `"${selector}" matches several workspaces:\n` +
                  found.ambiguous.map((w) => `  ${w.id}  ${w.name}`).join("\n"),
              );
            }
            const members = store
              .readState()
              .assignments.filter((a) => a.workspaceId === found.id)
              .slice(0, 200);
            return reply(
              { workspace: found, members },
              [
                formatWorkspace(found, members.length),
                ...members.map((m) => `  ${m.kind.padEnd(7)} ${m.refId}`),
              ].join("\n"),
            );
          }

          case "new": {
            const name = args.join(" ").trim();
            if (name === "") return fail(usage);
            const { workspace } = store.createWorkspace(name);
            return reply(
              workspace,
              `Created ${workspace.id}  ${workspace.name}`,
            );
          }

          case "rename": {
            const selector = args[0];
            const name = args.slice(1).join(" ").trim();
            if (selector === undefined || name === "") return fail(usage);
            const found = store.findWorkspace(selector);
            if (found === null || "ambiguous" in found) {
              return fail(`No single workspace matching "${selector}".`);
            }
            store.renameWorkspace(found.id, name);
            return reply(
              { id: found.id, name },
              `Renamed ${found.id} to ${name}`,
            );
          }

          case "rm": {
            const selector = args[0];
            if (selector === undefined) return fail(usage);
            const found = store.findWorkspace(selector);
            if (found === null || "ambiguous" in found) {
              return fail(`No single workspace matching "${selector}".`);
            }
            const moveToIndex = args.indexOf("--move-to");
            const moveTo = moveToIndex === -1 ? null : args[moveToIndex + 1];
            const memberCount = countMembers(found.id);
            // Refuse a silent destructive default: an agent should have to say
            // what happens to the members.
            if (!yes && moveTo === undefined) {
              return fail(
                `"${found.name}" holds ${memberCount} item(s). Re-run with --yes ` +
                  `to detach them, or --move-to <workspace> to keep them grouped.`,
              );
            }
            let reassign = "detach";
            if (moveTo !== undefined && moveTo !== null) {
              const target = store.findWorkspace(moveTo);
              if (target === null || "ambiguous" in target) {
                return fail(`No single workspace matching "${moveTo}".`);
              }
              reassign = target.id;
            }
            store.removeWorkspace(found.id, reassign);
            return reply(
              { removed: found.id, movedItems: memberCount, reassign },
              `Deleted ${found.name} (${memberCount} item(s) ${
                reassign === "detach" ? "detached" : "moved"
              })`,
            );
          }

          case "assign": {
            const selector = args[0];
            if (selector === undefined) return fail(usage);
            const found = store.findWorkspace(selector);
            if (found === null || "ambiguous" in found) {
              return fail(`No single workspace matching "${selector}".`);
            }
            const collected = collectItems(args.slice(1));
            if ("error" in collected) return fail(collected.error);
            assignItems(found.id, collected.items);
            return reply(
              { workspaceId: found.id, items: collected.items },
              `Moved ${collected.items.length} item(s) into ${found.name}`,
            );
          }

          case "unassign": {
            const collected = collectItems(args);
            if ("error" in collected) return fail(collected.error);
            store.clearAssignments(collected.items);
            return reply(
              { cleared: collected.items },
              `Cleared ${collected.items.length} assignment(s)`,
            );
          }

          case "detach": {
            const collected = collectItems(args);
            if ("error" in collected) return fail(collected.error);
            if (collected.items.some((item) => item.kind === "project")) {
              return fail(
                "Only threads can be detached. A project with no assignment is " +
                  "already Unassigned — use `bb workspace unassign` instead.",
              );
            }
            assignItems(null, collected.items);
            return reply(
              { detached: collected.items },
              `Detached ${collected.items.length} thread(s) to Unassigned`,
            );
          }

          case "status": {
            const wanted = args[0];
            if (wanted === undefined) return fail(usage);
            const status = wanted === "in-progress" ? null : wanted;
            if (status !== null && !isManualStatus(status)) {
              return fail(
                `Unknown status "${wanted}". Use in-progress, backlog, done or canceled.`,
              );
            }
            const collected = collectItems(args.slice(1));
            if ("error" in collected) return fail(collected.error);
            if (collected.items.some((item) => item.kind === "project")) {
              return fail("Only threads have a status.");
            }
            const threadIds = collected.items.map((item) => item.refId);
            store.setStatus(threadIds, status);
            return reply(
              { threadIds, status },
              `Filed ${threadIds.length} thread(s) as ${wanted}`,
            );
          }

          case "sort": {
            const selector = args[0];
            const mode = args[1];
            if (
              selector === undefined ||
              (mode !== "recent" && mode !== "manual")
            ) {
              return fail(usage);
            }
            const found = store.findWorkspace(selector);
            if (found === null || "ambiguous" in found) {
              return fail(`No single workspace matching "${selector}".`);
            }
            store.setSortMode(found.id, mode);
            return reply(
              { id: found.id, sortMode: mode },
              `${found.name}: ${mode}`,
            );
          }
        }
        return fail(usage);
      } catch (cause) {
        return fail(cause instanceof Error ? cause.message : String(cause));
      }
    },
  });

  bb.log.info("workspace sidebar ready");
}
