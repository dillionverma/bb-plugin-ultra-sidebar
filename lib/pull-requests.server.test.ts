import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./store.server";
import {
  createPullRequestBindings,
  createPullRequestReader,
} from "./pull-requests.server";

const target = { threadId: "thread", environmentId: "env" };

afterEach(() => vi.restoreAllMocks());

const hostPull = {
  number: 1019,
  title: "chore: remove retired archives",
  url: "https://github.com/productstudioinc/cops/pull/1019",
  state: "open",
  attention: "none",
  checks: { state: "passing", failedCount: 0 },
};

function setup({
  outcome = "available",
  title = "Review PR #1019: chore: remove retired archives",
  titleFallback = "Review placeholder for https://github.com/productstudioinc/cops/pull/1019",
  fetched = { ...hostPull, state: "merged" as const, attention: "merged", checksState: "passing", failedChecks: 0 },
} = {}) {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  const bindings = createPullRequestBindings(db);
  const environments = {
    pullRequest: vi.fn().mockResolvedValue(
      outcome === "available"
        ? { outcome, pullRequest: hostPull }
        : outcome === "absent"
          ? { outcome }
          : { outcome, message: "workspace_unavailable" },
    ),
  };
  const threads = { get: vi.fn().mockResolvedValue({ title, titleFallback }) };
  const fetch = vi.fn().mockResolvedValue(fetched);
  const read = createPullRequestReader({
    environments: environments as never,
    threads: threads as never,
    bindings,
    fetch,
  });
  return { bindings, environments, threads, fetch, read };
}

describe("pull request reader", () => {
  it("answers from the environment and binds the number for later", async () => {
    const { read, bindings, fetch } = setup();
    expect(await read([target])).toEqual([{ threadId: "thread", ...{
      number: 1019,
      title: hostPull.title,
      url: hostPull.url,
      state: "open",
      attention: "none",
      checksState: "passing",
      failedChecks: 0,
    } }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(bindings.read("thread")).toMatchObject({
      repo: "productstudioinc/cops",
      number: 1019,
    });
  });

  it("keeps answering after the checkout it learned from is deleted", async () => {
    const { bindings } = setup();
    // What the environment taught us yesterday.
    bindings.write("thread", { repo: "productstudioinc/cops", number: 1019 }, {
      ...hostPull,
      state: "open",
      checksState: "passing",
      failedChecks: 0,
    });
    const fetch = vi.fn().mockResolvedValue({
      ...hostPull, state: "merged", attention: "merged", checksState: "passing", failedChecks: 0,
    });
    const read = createPullRequestReader({
      environments: { pullRequest: vi.fn().mockResolvedValue({ outcome: "unavailable", message: "gone" }) } as never,
      threads: { get: vi.fn() } as never,
      bindings,
      fetch,
    });
    // The bug this fixes: without the binding this row reported no pull
    // request at all, and the sidebar filed merged work under In progress.
    expect(await read([target])).toMatchObject([{ threadId: "thread", state: "merged" }]);
    expect(fetch).toHaveBeenCalledWith({ repo: "productstudioinc/cops", number: 1019 });
    // The refreshed state replaces what was stored.
    expect(bindings.read("thread")?.snapshot.state).toBe("merged");
  });

  it("trusts an environment that says there is no pull request", async () => {
    const { read, bindings, fetch, threads } = setup({ outcome: "absent" });
    bindings.write("thread", { repo: "acme/app", number: 3 }, {
      number: 3, title: "old", url: "https://github.com/acme/app/pull/3",
      state: "open", attention: "none", checksState: null, failedChecks: 0,
    });
    // "absent" is the branch answering for itself, so a stale binding must not
    // outrank it — that is how a row would get stuck on a merged predecessor.
    expect(await read([target])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(threads.get).not.toHaveBeenCalled();
  });

  it("never re-asks about a merged pull request", async () => {
    const { bindings } = setup();
    bindings.write("thread", { repo: "acme/app", number: 3 }, {
      number: 3, title: "done", url: "https://github.com/acme/app/pull/3",
      state: "merged", attention: "merged", checksState: "passing", failedChecks: 0,
    });
    const fetch = vi.fn();
    const read = createPullRequestReader({
      environments: { pullRequest: vi.fn().mockResolvedValue({ outcome: "unavailable", message: "gone" }) } as never,
      threads: { get: vi.fn() } as never,
      bindings,
      fetch,
    });
    expect(await read([target])).toMatchObject([{ state: "merged" }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["closed", "merged"])("refreshes a pull request %s elsewhere", async (state) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const { read, environments, bindings } = setup();
    expect(await read([target])).toMatchObject([{ state: "open" }]);
    environments.pullRequest.mockResolvedValue({
      outcome: "available",
      pullRequest: { ...hostPull, state, attention: state },
    });
    now.mockReturnValue(30_001);
    expect(await read([target])).toMatchObject([{ state, attention: state }]);
    expect(bindings.read("thread")?.snapshot.state).toBe(state);
  });

  it("refreshes a closed binding when the pull request reopens elsewhere", async () => {
    const { read, bindings, fetch } = setup({ outcome: "unavailable" });
    bindings.write("thread", { repo: "productstudioinc/cops", number: 1019 }, {
      ...hostPull,
      state: "closed",
      attention: "closed",
      checksState: "passing",
      failedChecks: 0,
    });
    fetch.mockResolvedValue({
      ...hostPull,
      state: "open",
      checksState: "passing",
      failedChecks: 0,
    });
    expect(await read([target])).toMatchObject([{ state: "open", attention: "none" }]);
    expect(bindings.read("thread")?.snapshot.state).toBe("open");
  });

  it("keeps the stale snapshot when a refresh fails", async () => {
    const { bindings } = setup();
    bindings.write("thread", { repo: "acme/app", number: 3 }, {
      number: 3, title: "open one", url: "https://github.com/acme/app/pull/3",
      state: "open", attention: "none", checksState: null, failedChecks: 0,
    });
    const read = createPullRequestReader({
      environments: { pullRequest: vi.fn().mockRejectedValue(new Error("host down")) } as never,
      threads: { get: vi.fn() } as never,
      bindings,
      fetch: vi.fn().mockResolvedValue(null),
    });
    expect(await read([target])).toMatchObject([{ state: "open", number: 3 }]);
  });

  it("recovers a thread that was never bound by reading its own title", async () => {
    const { read, bindings, fetch, threads } = setup({ outcome: "unavailable" });
    expect(await read([target])).toMatchObject([{ threadId: "thread", state: "merged" }]);
    expect(threads.get).toHaveBeenCalledWith({ threadId: "thread" });
    expect(fetch).toHaveBeenCalledWith({ repo: "productstudioinc/cops", number: 1019 });
    // Bound now, so the next paint costs nothing.
    expect(bindings.read("thread")?.number).toBe(1019);
  });

  it("gives up quietly on a thread whose text names no pull request", async () => {
    const { read, fetch, threads } = setup({
      outcome: "unavailable",
      title: "Fix sidebar hover",
      titleFallback: null as never,
    });
    expect(await read([target])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    // And does not re-ask on the next paint.
    expect(await read([target])).toEqual([]);
    expect(threads.get).toHaveBeenCalledTimes(1);
  });

  it("asks once per environment and once per pull request", async () => {
    const { read, environments, fetch } = setup({ outcome: "unavailable" });
    await read([target, { threadId: "other", environmentId: "env" }]);
    expect(environments.pullRequest).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries a failed lookup on the next paint instead of caching the failure", async () => {
    const { bindings } = setup();
    bindings.write("thread", { repo: "acme/app", number: 3 }, {
      number: 3, title: "open one", url: "https://github.com/acme/app/pull/3",
      state: "open", attention: "none", checksState: null, failedChecks: 0,
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        number: 3, title: "open one", url: "https://github.com/acme/app/pull/3",
        state: "merged", attention: "merged", checksState: "passing", failedChecks: 0,
      });
    const read = createPullRequestReader({
      environments: { pullRequest: vi.fn().mockResolvedValue({ outcome: "unavailable", message: "gone" }) } as never,
      threads: { get: vi.fn() } as never,
      bindings,
      fetch,
    });
    // A slow git host must not pin the row to a stale answer for a whole TTL.
    expect(await read([target])).toMatchObject([{ state: "open" }]);
    expect(await read([target])).toMatchObject([{ state: "merged" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("remembers that a thread names no pull request, but not that we failed to ask", async () => {
    const asked = setup({ outcome: "unavailable", title: "Fix hover", titleFallback: null as never });
    await asked.read([target]);
    await asked.read([target]);
    expect(asked.threads.get).toHaveBeenCalledTimes(1);

    const failed = setup({ outcome: "unavailable" });
    failed.threads.get.mockRejectedValue(new Error("thread gone"));
    await failed.read([target]);
    await failed.read([target]);
    expect(failed.threads.get).toHaveBeenCalledTimes(2);
  });
});
