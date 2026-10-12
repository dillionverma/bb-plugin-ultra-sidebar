import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

type PullRequestResult = Awaited<ReturnType<BbPluginApi["sdk"]["environments"]["pullRequest"]>>;
type AvailablePullRequest = Extract<PullRequestResult, { outcome: "available" }>["pullRequest"];

function pullRequest(state: AvailablePullRequest["state"]): PullRequestResult {
  return {
    outcome: "available",
    pullRequest: {
      number: 12,
      title: "Fix sidebar status",
      url: "https://github.com/acme/sidebar/pull/12",
      state,
      attention: state === "open" ? "none" : state,
      baseRefName: "main",
      headRefName: "fix-sidebar-status",
      updatedAt: "2026-10-12T12:00:00Z",
      checks: { state: "passing", failedCount: 0, passedCount: 1, pendingCount: 0, totalCount: 1 },
      mergeability: { state: "mergeable", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
      review: { state: "none", reviewRequestCount: 0 },
    },
  };
}

function listedRow(status: string) {
  return [{
    threadId: "thread",
    projectId: "project",
    title: "Fix sidebar status",
    status,
    snoozedUntil: null,
    sortIndex: null,
  }];
}

async function setup(initial: PullRequestResult) {
  const thread = makeThreadResponse({
    id: "thread", projectId: "project", environmentId: "environment", title: "Fix sidebar status",
  });
  const readPull = vi.fn(async () => initial);
  const { bb, harness } = createFakePluginHost({
    pluginId: "workspace-sidebar",
    sdk: {
      threads: { list: async () => [thread], events: { list: async () => [] } },
      environments: { pullRequest: readPull },
    },
  });
  await plugin(bb);
  return { harness, readPull };
}

afterEach(() => vi.restoreAllMocks());

describe("sidebar CLI pull request status", () => {
  it.each([
    ["closed", "canceled"],
    ["merged", "done"],
  ] as const)("updates the listed status when a PR is %s elsewhere", async (state, status) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const { harness, readPull } = await setup(pullRequest("open"));
    try {
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow("in-review")),
      });
      readPull.mockResolvedValue(pullRequest(state));
      now.mockReturnValue(30_001);
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow(status)),
      });
      expect(readPull).toHaveBeenCalledWith({ environmentId: "environment" });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("returns to in-review when a closed PR reopens elsewhere", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const { harness, readPull } = await setup(pullRequest("closed"));
    try {
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow("canceled")),
      });
      readPull.mockResolvedValue(pullRequest("open"));
      now.mockReturnValue(30_001);
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow("in-review")),
      });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it.each(["backlog", "done", "canceled"] as const)("preserves manual %s over the PR status", async status => {
    const { harness } = await setup(pullRequest("open"));
    try {
      await harness.behavior.callRpc("lifecycle.setStatus", { threadIds: ["thread"], status });
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow(status)),
      });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("keeps threads without a PR in progress", async () => {
    const { harness } = await setup({ outcome: "absent" });
    try {
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow("in-progress")),
      });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("lists threads without an environment without attempting a PR lookup", async () => {
    const readPull = vi.fn();
    const { bb, harness } = createFakePluginHost({
      pluginId: "workspace-sidebar",
      sdk: {
        threads: {
          list: async () => [makeThreadResponse({
            id: "thread", projectId: "project", environmentId: null, title: "Fix sidebar status",
          })],
          events: { list: async () => [] },
        },
        environments: { pullRequest: readPull },
      },
    });
    try {
      await plugin(bb);
      expect(await harness.behavior.runCli(["list", "--json"])).toMatchObject({
        exitCode: 0, stdout: JSON.stringify(listedRow("in-progress")),
      });
      expect(readPull).not.toHaveBeenCalled();
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("fetches only the first 200 threads in the requested project", async () => {
    const readPull = vi.fn(async (): Promise<PullRequestResult> => ({ outcome: "absent" }));
    const threads = [
      makeThreadResponse({ id: "other", projectId: "other-project", environmentId: "other-environment" }),
      ...Array.from({ length: 201 }, (_, i) => makeThreadResponse({
        id: `thread-${i}`, projectId: "project", environmentId: `environment-${i}`,
      })),
    ];
    const { bb, harness } = createFakePluginHost({
      pluginId: "workspace-sidebar",
      sdk: {
        threads: { list: async () => threads, events: { list: async () => [] } },
        environments: { pullRequest: readPull },
      },
    });
    try {
      await plugin(bb);
      expect(await harness.behavior.runCli(["list", "--project", "project", "--json"])).toMatchObject({ exitCode: 0 });
      expect(readPull).toHaveBeenCalledTimes(200);
      expect(readPull).not.toHaveBeenCalledWith({ environmentId: "other-environment" });
      expect(readPull).not.toHaveBeenCalledWith({ environmentId: "environment-200" });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
