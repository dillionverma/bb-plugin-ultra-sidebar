// Resolving a thread's pull request, and remembering it afterwards.
//
// Server-only: importing this from app.tsx would drag better-sqlite3 and
// child_process into the browser bundle. The pure half is in pull-requests.ts.
import { execFile } from "node:child_process";
import type { Database } from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  GH_PULL_FIELDS,
  isSettled,
  parsePullRequestRef,
  pullRequestFromGh,
  type PullRequestRef,
  type PullRequestSnapshot,
  type PullRequestState,
} from "./pull-requests";

/** Appended to the store's migrations. See the note on MIGRATIONS first. */
export const PULL_REQUEST_MIGRATION = `CREATE TABLE IF NOT EXISTS thread_pull_request (
     thread_id     TEXT PRIMARY KEY,
     repo          TEXT NOT NULL,
     number        INTEGER NOT NULL,
     title         TEXT NOT NULL,
     url           TEXT NOT NULL,
     state         TEXT NOT NULL,
     attention     TEXT NOT NULL,
     checks_state  TEXT,
     failed_checks INTEGER NOT NULL DEFAULT 0,
     updated_at    INTEGER NOT NULL
   )`;

interface PullRequestBinding extends PullRequestRef {
  snapshot: PullRequestSnapshot;
}

export interface PullRequestBindings {
  read(threadId: string): PullRequestBinding | null;
  write(threadId: string, ref: PullRequestRef, snapshot: PullRequestSnapshot): void;
}

interface BindingRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  attention: string;
  checks_state: string | null;
  failed_checks: number;
}

const STATES: readonly PullRequestState[] = ["open", "draft", "merged", "closed"];

/**
 * The durable half: which pull request a thread is about.
 *
 * Kept out of SidebarState on purpose. That state is what the person arranged
 * — order, triage, snooze — and every write to it bumps a revision that every
 * open window reacts to. A pull request is a fact about the world, refreshed
 * on a timer, and repainting every sidebar each time a check goes green would
 * be a poor trade for a badge.
 */
export function createPullRequestBindings(db: Database): PullRequestBindings {
  const select = db.prepare<[string], BindingRow>(
    `SELECT repo, number, title, url, state, attention, checks_state, failed_checks
       FROM thread_pull_request WHERE thread_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO thread_pull_request
       (thread_id, repo, number, title, url, state, attention, checks_state,
        failed_checks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       repo = excluded.repo, number = excluded.number, title = excluded.title,
       url = excluded.url, state = excluded.state,
       attention = excluded.attention, checks_state = excluded.checks_state,
       failed_checks = excluded.failed_checks, updated_at = excluded.updated_at`,
  );

  return {
    read(threadId) {
      const row = select.get(threadId);
      if (row === undefined) return null;
      const state = STATES.find((candidate) => candidate === row.state);
      if (state === undefined) return null;
      return {
        repo: row.repo,
        number: row.number,
        snapshot: {
          number: row.number,
          title: row.title,
          url: row.url,
          state,
          attention: row.attention,
          checksState: row.checks_state,
          failedChecks: row.failed_checks,
        },
      };
    },

    write(threadId, ref, snapshot) {
      upsert.run(
        threadId,
        ref.repo,
        ref.number,
        snapshot.title,
        snapshot.url,
        snapshot.state,
        snapshot.attention,
        snapshot.checksState,
        snapshot.failedChecks,
        Date.now(),
      );
    },
  };
}

/** One `gh pr view` by number. Works with the head branch long deleted. */
function fetchPullRequest(
  ref: PullRequestRef,
): Promise<PullRequestSnapshot | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      [
        "pr",
        "view",
        String(ref.number),
        "-R",
        ref.repo,
        "--json",
        GH_PULL_FIELDS.join(","),
      ],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          resolve(pullRequestFromGh(JSON.parse(stdout), ref));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export type PullRequestEntry = PullRequestSnapshot & { threadId: string };

type Target = { threadId: string; environmentId: string };
type Environments = Pick<BbPluginApi["sdk"]["environments"], "pullRequest">;
type Threads = Pick<BbPluginApi["sdk"]["threads"], "get">;

export interface PullRequestReaderDeps {
  environments: Environments;
  threads: Threads;
  bindings: PullRequestBindings;
  /** Injected in tests; defaults to spawning `gh`. */
  fetch?: (ref: PullRequestRef) => Promise<PullRequestSnapshot | null>;
}

// A git-host round trip is the expensive part, and several threads can share
// one environment, so the environment answer is cached by environment.
const ENVIRONMENT_TTL_MS = 30_000;
// Keyed by pull request, so two threads watching one PR cost one lookup.
const FETCH_TTL_MS = 30_000;
// A closed pull request changes only if somebody reopens it, which is rare
// enough that noticing it minutes later is fine; an open one changes with
// every push and review.
const CLOSED_FETCH_TTL_MS = 5 * 60_000;
// A thread whose text names no pull request will not start naming one soon.
const DISCOVERY_TTL_MS = 10 * 60_000;
const CONCURRENCY = 4;

type EnvironmentAnswer =
  | { kind: "available"; snapshot: PullRequestSnapshot }
  | { kind: "absent" }
  | { kind: "unknown" };

/**
 * Narrow bb's pull request response to the three answers that change what we
 * do next. The distinction bb draws between "absent" and "unavailable" is the
 * whole point: absent is the environment telling us, authoritatively, that its
 * branch has no pull request. Unavailable is the environment failing to
 * answer — a deleted checkout, an unreachable host — and treating that as "no
 * pull request" is exactly the bug this module exists to fix.
 */
function narrow(result: {
  outcome: string;
  pullRequest?: unknown;
}): EnvironmentAnswer {
  if (result.outcome === "absent") return { kind: "absent" };
  if (result.outcome !== "available") return { kind: "unknown" };
  const pr = result.pullRequest as {
    number: number;
    title: string;
    url: string;
    state: PullRequestState;
    attention: string;
    checks?: { state?: string; failedCount?: number };
  };
  return {
    kind: "available",
    snapshot: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      attention: pr.attention,
      checksState: pr.checks?.state ?? null,
      failedChecks: pr.checks?.failedCount ?? 0,
    },
  };
}

/**
 * Pull request state for a batch of threads.
 *
 * Three sources, in descending order of authority:
 *
 *   1. The environment, via bb's own API. Live, complete, and the only one
 *      that can discover a pull request nobody has told us about yet.
 *   2. The binding this module wrote the last time source 1 worked. Survives
 *      the checkout it was learned from. Settled pull requests stop here and
 *      never touch the network again.
 *   3. The thread's own title, for a thread whose environment died before we
 *      ever saw its pull request. Writes a binding, so it runs once.
 *
 * Every source writes the binding back, so a thread only has to be resolvable
 * once, ever, for its status to stay right for the rest of its life.
 */
export function createPullRequestReader(deps: PullRequestReaderDeps) {
  const fetchPull = deps.fetch ?? fetchPullRequest;
  const environmentCache = new Map<string, { at: number; value: EnvironmentAnswer }>();
  const fetchCache = new Map<string, { at: number; value: PullRequestSnapshot | null }>();
  const discoveryCache = new Map<
    string,
    { at: number; value: PullRequestRef | null | undefined }
  >();
  const waiting: (() => void)[] = [];
  let active = 0;

  /**
   * Cache-and-dedupe around one keyed lookup.
   *
   * A sidebar paint asks about every visible thread at once, so without this
   * two threads sharing an environment — or watching the same pull request —
   * each start their own round trip, and the cache only closes the door after
   * both are already through it.
   */
  function memoize<T>(
    cache: Map<string, { at: number; value: T }>,
    inFlight: Map<string, Promise<T>>,
    ttl: number | ((value: T) => number),
    load: (key: string) => Promise<T>,
    /**
     * Whether an answer is worth keeping. A failure is not: caching it turns
     * one slow git host into a minute of rows insisting a merged pull request
     * does not exist, which is the failure this module exists to prevent.
     */
    cacheable: (value: T) => boolean = () => true,
  ) {
    return (key: string): Promise<T> => {
      const cached = cache.get(key);
      if (cached !== undefined) {
        const freshFor = typeof ttl === "function" ? ttl(cached.value) : ttl;
        if (Date.now() - cached.at < freshFor) return Promise.resolve(cached.value);
      }
      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;
      const request = load(key)
        .then((value) => {
          if (cacheable(value)) cache.set(key, { at: Date.now(), value });
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    };
  }

  async function limit<T>(work: () => Promise<T>): Promise<T> {
    if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
    else active += 1;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  const readEnvironment = memoize(
    environmentCache,
    new Map<string, Promise<EnvironmentAnswer>>(),
    ENVIRONMENT_TTL_MS,
    async (environmentId) => {
      try {
        return narrow(await deps.environments.pullRequest({ environmentId }));
      } catch {
        // A git-host hiccup is not evidence that a pull request stopped
        // existing. Leaving this "unknown" hands the row to the binding.
        return { kind: "unknown" } as EnvironmentAnswer;
      }
    },
  );

  const fetchByKey = memoize(
    fetchCache,
    new Map<string, Promise<PullRequestSnapshot | null>>(),
    (snapshot) => (snapshot?.state === "closed" ? CLOSED_FETCH_TTL_MS : FETCH_TTL_MS),
    (key) => {
      const [repo, number] = key.split("#");
      return limit(() => fetchPull({ repo, number: Number(number) }));
    },
    (snapshot) => snapshot !== null,
  );

  const refresh = (ref: PullRequestRef) => fetchByKey(`${ref.repo}#${ref.number}`);

  /** Source 3: ask the thread what it says it is for. */
  const discover = memoize(
    discoveryCache,
    new Map<string, Promise<PullRequestRef | null | undefined>>(),
    DISCOVERY_TTL_MS,
    async (threadId) => {
      try {
        const thread = await deps.threads.get({ threadId });
        // null is a real answer — this thread's text names no pull request —
        // and worth remembering. undefined means we never got to ask.
        return parsePullRequestRef(thread?.title, thread?.titleFallback);
      } catch {
        return undefined;
      }
    },
    (ref) => ref !== undefined,
  );

  async function read(target: Target): Promise<PullRequestSnapshot | null> {
    const { threadId, environmentId } = target;
    const answer = await readEnvironment(environmentId);
    if (answer.kind === "available") {
      deps.bindings.write(threadId, { repo: repoOf(answer.snapshot.url), number: answer.snapshot.number }, answer.snapshot);
      return answer.snapshot;
    }
    // The environment is certain there is no pull request. Believe it, and do
    // not resurrect a binding from a branch that has moved on.
    if (answer.kind === "absent") return null;

    const binding = deps.bindings.read(threadId);
    if (binding !== null) {
      if (isSettled(binding.snapshot.state) || binding.repo === "") {
        return binding.snapshot;
      }
      const ref = { repo: binding.repo, number: binding.number };
      const refreshed = await refresh(ref);
      if (refreshed === null) return binding.snapshot;
      deps.bindings.write(threadId, ref, refreshed);
      return refreshed;
    }

    const ref = await discover(threadId);
    if (ref === null || ref === undefined) return null;
    const snapshot = await refresh(ref);
    if (snapshot === null) return null;
    deps.bindings.write(threadId, ref, snapshot);
    return snapshot;
  }

  return async (targets: readonly Target[]): Promise<PullRequestEntry[]> => {
    const entries = await Promise.all(
      targets.map(async (target) => {
        const snapshot = await read(target);
        return snapshot === null ? null : { threadId: target.threadId, ...snapshot };
      }),
    );
    return entries.filter((entry): entry is PullRequestEntry => entry !== null);
  };
}

/**
 * The repository a pull request URL belongs to.
 *
 * bb hands back a URL rather than an owner/repo pair, and the binding needs
 * the pair to ask about the number later. An unparseable URL yields "", which
 * simply makes the binding unusable for refreshing — the snapshot still
 * stores, and the environment stays the source of truth for that thread.
 */
function repoOf(url: string): string {
  return parsePullRequestRef(url)?.repo ?? "";
}
