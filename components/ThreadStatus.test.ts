import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadPullRequest } from "@/hooks/useThreadPullRequests";
import { threadStatus } from "./ThreadStatus";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "t1",
    projectId: "p1",
    title: "t1",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "p",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  } as PluginSidebarThread;
}

function pr(overrides: Partial<ThreadPullRequest> = {}): ThreadPullRequest {
  return {
    number: 42,
    title: "Add the thing",
    url: "https://example.test/42",
    state: "open",
    attention: "none",
    checksState: null,
    failedChecks: 0,
    ...overrides,
  };
}

describe("threadStatus", () => {
  it("says nothing when there is nothing to say", () => {
    expect(threadStatus(thread())).toBeNull();
  });

  it("reports the plain states", () => {
    expect(threadStatus(thread({ indicator: "runtime" }))).toMatchObject({
      text: "Working",
      tone: "working",
    });
    expect(threadStatus(thread({ indicator: "waiting-for-input" }))).toMatchObject(
      { text: "Your turn", tone: "needs-you" },
    );
    expect(threadStatus(thread({ indicator: "unread-error" }))).toMatchObject({
      text: "Failed",
      tone: "problem",
    });
  });

  // The ranking is the whole design: a thread can be several things at once.
  it("puts a pending interaction above everything else", () => {
    const status = threadStatus(
      thread({ hasPendingInteraction: true, indicator: "runtime" }),
      pr({ state: "merged", attention: "merged" }),
      "done",
    );
    expect(status).toMatchObject({ text: "Your turn", tone: "needs-you" });
  });

  it("puts a failure above a merged pull request", () => {
    const status = threadStatus(
      thread({ indicator: "unread-error" }),
      pr({ state: "merged", attention: "merged" }),
    );
    expect(status).toMatchObject({ text: "Failed", tone: "problem" });
  });

  it("puts a blocking pull request above the agent merely running", () => {
    const status = threadStatus(
      thread({ indicator: "runtime" }),
      pr({ attention: "conflicts" }),
    );
    expect(status).toMatchObject({ text: "Conflicts", tone: "problem" });
  });

  it("keeps working above a pull request awaiting review", () => {
    const status = threadStatus(
      thread({ indicator: "background-agent" }),
      pr({ attention: "review_requested" }),
    );
    expect(status).toMatchObject({ text: "Working", tone: "working" });
  });

  // The agent opened a PR and stopped: the next move is the reader's.
  it("puts an open pull request on a quiet thread in review", () => {
    expect(
      threadStatus(thread(), pr({ attention: "review_requested" })),
    ).toMatchObject({ text: "In review", tone: "review" });
    expect(threadStatus(thread(), pr({ attention: "none" }))).toMatchObject({
      text: "In review",
      tone: "review",
    });
    expect(
      threadStatus(thread(), pr({ attention: "checks_pending" })),
    ).toMatchObject({ text: "Checks", tone: "review" });
    expect(
      threadStatus(thread(), pr({ state: "draft", attention: "draft" })),
    ).toMatchObject({ text: "PR draft", tone: "idle" });
  });

  it("puts an open pull request above a hand-filed status", () => {
    expect(
      threadStatus(thread(), pr({ attention: "review_requested" }), "backlog"),
    ).toMatchObject({ tone: "review" });
  });

  it("reports merged and closed pull requests on an idle thread", () => {
    expect(
      threadStatus(thread(), pr({ state: "merged", attention: "merged" })),
    ).toMatchObject({ text: "Merged", tone: "done" });
    expect(
      threadStatus(thread(), pr({ state: "closed", attention: "closed" })),
    ).toMatchObject({ text: "Closed", tone: "idle" });
  });

  it("reports ready-to-merge and failing checks", () => {
    expect(
      threadStatus(thread(), pr({ attention: "ready_to_merge" })),
    ).toMatchObject({ text: "Ready", tone: "review" });
    expect(
      threadStatus(thread(), pr({ attention: "checks_failed" })),
    ).toMatchObject({ text: "Checks failed", tone: "problem" });
  });

  // Filing is a decision about the work; a real state the thread reports wins.
  it("names a hand-filed status only when nothing else is going on", () => {
    expect(threadStatus(thread(), undefined, "done")).toMatchObject({
      text: "Done",
      tone: "done",
    });
    expect(threadStatus(thread(), undefined, "backlog")).toMatchObject({
      text: "Backlog",
      tone: "idle",
    });
    expect(threadStatus(thread(), undefined, "canceled")).toMatchObject({
      text: "Canceled",
      tone: "idle",
    });
    expect(
      threadStatus(thread({ indicator: "runtime" }), undefined, "done"),
    ).toMatchObject({ text: "Working", tone: "working" });
  });

  it("treats an unknown indicator as nothing rather than crashing", () => {
    const status = threadStatus(
      thread({ indicator: "some-future-kind" as PluginSidebarThread["indicator"] }),
    );
    expect(status).toBeNull();
  });
});
