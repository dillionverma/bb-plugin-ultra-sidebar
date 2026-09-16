// bb-plugin-ultra-sidebar — backend entry.
//
// Owns the sidebar's own state: the hand-picked order of projects and threads,
// and each thread's triage status and snooze. bb's own projects and threads are
// never mutated for it, so uninstalling this plugin loses that state and
// nothing else.
//
// Three surfaces share one store: the replaced sidebar (app.tsx, over RPC),
// the `bb sidebar` CLI, and the skill in skills/sidebar/SKILL.md. Every
// write goes through Store.withWrite, which bumps a revision and publishes a
// realtime signal, so a change from any surface reaches every open window.
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createStore, MIGRATIONS, type Store } from "./lib/store.server";
import { placeItem, toPlacement } from "./lib/order";
import { SIDEBAR_CHANGED, type ItemKind, type Placement } from "./lib/types";
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

const orderSchema = z.object({
  kind: itemKindSchema,
  refId: z.string(),
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
  order: z.array(orderSchema),
  lifecycle: z.array(lifecycleSchema),
});

const placementSchema = z.object({
  kind: itemKindSchema,
  refId: z.string(),
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
  /** Delete an automation for good. Confirmed in the sidebar before it is sent. */
  "scheduledTasks.delete": {
    input: scheduledTaskRefSchema,
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
  "sidebar.state": { input: z.null(), output: stateSchema },
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
  "sidebar.edit": {
    input: z.object({
      before: stateSchema.extend({
        order: z.array(orderSchema).max(5000),
        lifecycle: z.array(lifecycleSchema).max(10000),
      }),
      after: stateSchema.extend({
        order: z.array(orderSchema).max(5000),
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
    input: z.object({ threadId: z.string().min(1), target: z.object({ providerId: z.string().min(1), model: z.string().min(1) }).optional() }),
    output: z.object({ threadId: z.string() }),
  },
  "threads.retry": {
    input: z.object({ threadId: z.string() }),
    output: z.object({ delivery: z.enum(["sent", "queued"]) }),
  },
  // One drop is one call: the client sends the complete post-drop list, so
  // every reorder is the same operation and retrying is harmless.
  "order.place": {
    input: z.object({ placements: z.array(placementSchema).max(5000) }),
    output: stateSchema,
  },
  // Delete the rows entirely -> those items sort by recency again.
  "order.clear": {
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

export default async function plugin(bb: BbPluginApi) {
  const scheduledTasks = createScheduledTasksReader(bb.sdk.plugins);
  const scheduledTaskActions = createScheduledTasksActions(bb.sdk.plugins, scheduledTasks.invalidate);
  const readThreadDiffs = createThreadDiffReader(bb.sdk.environments);
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const store: Store = createStore(db, (revision) => {
    bb.realtime.publish(SIDEBAR_CHANGED, { revision });
  });

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
    "scheduledTasks.delete": (ref) => scheduledTaskActions.remove(ref),
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
    "threads.handoff": async ({ threadId, target }) => {
      return await bb.sdk.plugins.callRpc({
        pluginId: "handoff", method: "handoff", input: { threadId, ...(target ? { target } : {}) },
        outputSchema: z.object({ threadId: z.string() }),
      });
    },
    "threads.retry": async ({ threadId }) => ({
      delivery: (await bb.sdk.threads.retry({ threadId })).delivery,
    }),
    "sidebar.state": () => store.readState(),
    "sidebar.edit": ({ before, after }) => store.edit(before, after),
    "order.place": ({ placements }) => store.placeOrder(placements),
    "order.clear": ({ items }) => store.clearOrder(items),
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

  // A deleted thread's position is dead weight, and a recycled id would
  // inherit it. Archived threads keep theirs — they come back.
  bb.events.on("thread.deleted", ({ thread }) => {
    executionCache.delete(thread.id);
    agentStates.delete(thread.id);
    try {
      store.clearOrder([{ kind: "thread", refId: thread.id }]);
    } catch (cause) {
      bb.log.warn(`Could not clear the order row for a deleted thread: ${cause}`);
    }
  });

  // ---- bb sidebar --------------------------------------------------------

  const usage = [
    "Usage:",
    "  bb sidebar list [--project <id>] [--json]",
    "  bb sidebar status (in-progress|backlog|done|canceled) (--thread <id>)... [--json]",
    "  bb sidebar snooze (--thread <id>) (--hours <n> | --until <epoch-ms> | --wake) [--json]",
    "  bb sidebar order (--project <id> | --thread <id>)... [--json]",
    "  bb sidebar unorder (--project <id> | --thread <id>)... [--json]",
    "",
    "`order` puts the items in the order given, ahead of everything the",
    "sidebar has not been told about; `unorder` hands them back to recency.",
  ].join("\n");

  /** Collect repeated --project/--thread flags into item refs, in order. */
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

  function flagValue(args: string[], flag: string): string | null {
    const index = args.indexOf(flag);
    if (index === -1) return null;
    const value = args[index + 1];
    return value === undefined || value.startsWith("--") ? null : value;
  }

  bb.cli.register({
    name: "sidebar",
    summary: "Read and file the threads the Ultra Sidebar shows",
    commands: [
      {
        name: "list",
        summary: "List threads with their status, order and snooze",
        usage: "bb sidebar list [--project <id>] [--json]",
      },
      {
        name: "status",
        summary:
          "File threads in Backlog, Done or Canceled, or back In progress",
        usage:
          "bb sidebar status (in-progress|backlog|done|canceled) (--thread <id>)...",
      },
      {
        name: "snooze",
        summary: "Park a thread in the Snoozed dock until a time",
        usage:
          "bb sidebar snooze --thread <id> (--hours <n> | --until <epoch-ms> | --wake)",
      },
      {
        name: "order",
        summary: "Put projects or threads in a hand-picked order",
        usage: "bb sidebar order (--project <id> | --thread <id>)...",
      },
      {
        name: "unorder",
        summary: "Drop a hand-picked order, back to newest first",
        usage: "bb sidebar unorder (--project <id> | --thread <id>)...",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const rest = argv.filter((arg) => arg !== "--json");
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
            const statusById = new Map(
              state.lifecycle.map((row) => [row.threadId, row]),
            );
            const orderById = new Map(
              state.order
                .filter((row) => row.kind === "thread")
                .map((row) => [row.refId, row.sortIndex]),
            );
            const wantedProject = flagValue(args, "--project");
            const threads = (
              await bb.sdk.threads.list({ archived: false })
            ).filter(
              (thread) =>
                wantedProject === null || thread.projectId === wantedProject,
            );
            const rows = threads.slice(0, 200).map((thread) => ({
              threadId: thread.id,
              projectId: thread.projectId,
              title: thread.title,
              status: statusById.get(thread.id)?.status ?? "in-progress",
              snoozedUntil: statusById.get(thread.id)?.snoozedUntil ?? null,
              sortIndex: orderById.get(thread.id) ?? null,
            }));
            if (rows.length === 0) {
              return reply([], "No threads.");
            }
            return reply(
              rows,
              rows
                .map(
                  (row) =>
                    `${row.threadId}  ${String(row.status).padEnd(11)} ${
                      row.title ?? "Untitled"
                    }`,
                )
                .join("\n"),
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

          case "snooze": {
            const collected = collectItems(args);
            if ("error" in collected) return fail(collected.error);
            if (collected.items.length !== 1) {
              return fail("Snooze takes exactly one --thread <id>.");
            }
            const item = collected.items[0]!;
            if (item.kind !== "thread") return fail("Only threads snooze.");
            const hours = flagValue(args, "--hours");
            const untilFlag = flagValue(args, "--until");
            let until: number | null = null;
            if (args.includes("--wake")) {
              until = null;
            } else if (hours !== null) {
              const parsed = Number.parseFloat(hours);
              if (!Number.isFinite(parsed) || parsed <= 0) {
                return fail("--hours needs a positive number.");
              }
              until = Date.now() + parsed * 60 * 60 * 1000;
            } else if (untilFlag !== null) {
              const parsed = Number.parseInt(untilFlag, 10);
              if (!Number.isFinite(parsed)) {
                return fail("--until needs an epoch-millisecond timestamp.");
              }
              until = parsed;
            } else {
              return fail("Pass --hours <n>, --until <epoch-ms>, or --wake.");
            }
            store.setSnoozed(item.refId, until);
            return reply(
              { threadId: item.refId, until },
              until === null
                ? `Woke ${item.refId}`
                : `Snoozed ${item.refId} until ${new Date(until).toISOString()}`,
            );
          }

          case "order": {
            const collected = collectItems(args);
            if ("error" in collected) return fail(collected.error);
            // The given items lead; everything already placed follows, so a
            // partial list never scrambles the rest.
            const existing = store
              .readState()
              .order.map(toPlacement)
              .filter(
                (placement) =>
                  !collected.items.some(
                    (item) =>
                      item.kind === placement.kind &&
                      item.refId === placement.refId,
                  ),
              );
            let placements: Placement[] = [...collected.items, ...existing];
            for (const item of collected.items) {
              placements = placeItem(placements, item, {
                anchorRefId: null,
                side: "after",
              });
            }
            store.placeOrder(placements);
            return reply(
              { ordered: collected.items },
              `Ordered ${collected.items.length} item(s)`,
            );
          }

          case "unorder": {
            const collected = collectItems(args);
            if ("error" in collected) return fail(collected.error);
            store.clearOrder(collected.items);
            return reply(
              { cleared: collected.items },
              `Cleared ${collected.items.length} hand-picked position(s)`,
            );
          }
        }
        return fail(usage);
      } catch (cause) {
        return fail(cause instanceof Error ? cause.message : String(cause));
      }
    },
  });

  bb.log.info("ultra sidebar ready");
}
