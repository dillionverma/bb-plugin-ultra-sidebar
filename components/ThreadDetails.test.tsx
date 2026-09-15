// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { QueueSummary } from "../lib/thread-queue";
import type { ProviderInfo } from "./sidebar-context";
import type { PullRequestStackData } from "./PullRequestStack";
import { ThreadDetails } from "./ThreadDetails";

const harness = vi.hoisted(() => ({
  openFolder: vi.fn(),
  openThread: vi.fn(),
  goal: vi.fn(),
  queue: undefined as QueueSummary | undefined,
  stack: null as PullRequestStackData | null,
}));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: harness.goal };
  return {
  experimental_ProviderIcon: () => <span aria-hidden data-testid="provider-icon" />,
  UrlLink: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => <a target="_blank" rel="noreferrer noopener" {...props}>{children}</a>,
  useRpc: () => rpc,
};
});
vi.mock("./sidebar-context", () => ({
  useSidebar: () => ({
    artworkOf: () => null,
    locationOf: () => ({ path: "/Users/test/src/bb", hostName: "mbp" }),
    openFolder: harness.openFolder,
    openThread: harness.openThread,
  }),
}));
vi.mock("../hooks/useThreadQueue", () => ({ useThreadQueue: () => harness.queue }));
vi.mock("./PullRequestStack", async (importOriginal) => ({
  ...await importOriginal<typeof import("./PullRequestStack")>(),
  usePullRequestStack: () => ({ data: harness.stack, isLoading: false }),
}));

const now = Date.now();
function thread(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id: "thread-tooltip",
    title: "Custom model picker for Cmd+N with a long readable thread title",
    titleFallback: null,
    projectId: "p1",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    hasPendingInteraction: false,
    host: { id: "h1", name: "mbp" },
    environment: { id: "e1", name: "Checkout", branchName: "main" },
    updatedAt: now - 14 * 60_000,
    ...overrides,
  } as PluginSidebarThread;
}
const provider = { id: "codex", displayName: "Codex" } as ProviderInfo;
const execution = { model: "gpt-6-astra", reasoningLevel: "medium", permissionMode: "auto", serviceTier: null };
function card(overrides: Partial<Parameters<typeof ThreadDetails>[0]> = {}) {
  return <ThreadDetails thread={thread()} projectName="bb" provider={provider} execution={execution} pullRequest={undefined} descendantCount={0} {...overrides} />;
}

beforeEach(() => {
  harness.openFolder.mockReset();
  harness.openThread.mockReset();
  harness.goal.mockReset().mockResolvedValue({ goal: null });
  harness.queue = undefined;
  harness.stack = null;
});
afterEach(cleanup);

describe("thread details", () => {
  it("keeps the title independent of status without showing agent steps or elapsed time", () => {
    render(card({ thread: thread({ indicator: "runtime" }) }));
    const title = screen.getByRole("heading", { name: thread().title! });
    expect(title.textContent).toBe(thread().title);
    expect(title.contains(screen.getByText("Working"))).toBe(false);
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
    expect(screen.queryByText("The agent is running")).toBeNull();
    expect(screen.queryByLabelText(/^Thread updated/)).toBeNull();
    expect(screen.queryByText(/Last active/)).toBeNull();
    expect(screen.getByText("bb")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("gpt-6-astra")).toBeTruthy();
    expect(document.querySelector('[data-machine-kind="laptop"]')).toBeTruthy();
  });

  it("reveals secondary details on demand without opening or renaming its row", () => {
    const openThread = vi.fn();
    const renameThread = vi.fn();
    render(<div onClick={openThread} onDoubleClick={renameThread}>{card()}</div>);
    const disclosure = screen.getByText("Details").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.getByLabelText("Thread updated 14m ago").closest("details")).toBeNull();
    expect(screen.getByTitle("Open folder").closest("details")).toBe(disclosure);
    expect(screen.getByText("Codex").closest("dl")).not.toBeNull();
    expect(screen.getByText("auto").closest("dl")).not.toBeNull();
    expect(screen.getByText("gpt-6-astra").closest("summary")).not.toBeNull();
    expect(disclosure.querySelector("time")?.dateTime).toBe(new Date(thread().updatedAt).toISOString());
    fireEvent.click(screen.getByText("Details"));
    expect(disclosure.open).toBe(true);
    fireEvent.click(screen.getByTitle("Open folder"));
    fireEvent.doubleClick(screen.getByRole("heading"));
    expect(harness.openFolder).toHaveBeenCalledWith("e1");
    expect(openThread).not.toHaveBeenCalled();
    expect(renameThread).not.toHaveBeenCalled();
  });

  it("keeps attention, goal, failed queue and PR details visible before expansion", async () => {
    harness.goal.mockResolvedValue({ goal: { objective: "Ship the picker", status: "active", timeUsedSeconds: 42, tokensUsed: 100, tokenBudget: null } });
    harness.queue = { threadId: "thread-tooltip", count: 2, sendAt: now + 60_000, failed: true, retry: false };
    const openRow = vi.fn();
    render(<div onClick={openRow}>{card({
      thread: thread({ indicator: "runtime", hasPendingInteraction: true, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 1 } }),
      pullRequest: { number: 42, title: "Fix picker", url: "https://github.com/o/r/pull/42", state: "open", attention: "checks_failed", checksState: "failure", failedChecks: 1 },
    })}</div>);
    expect(screen.getByText("Your turn").closest("details")).toBeNull();
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(screen.getByText("Queue failed").closest("details")).toBeNull();
    expect(screen.getByRole("link", { name: /#42 Fix picker/ }).closest("details")).toBeNull();
    expect((await screen.findByText("Ship the picker")).closest("details")).toBeNull();
    expect(screen.getByText("Details").closest("details")!.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    expect(harness.openThread).toHaveBeenCalledWith("thread-tooltip", false);
    expect(openRow).not.toHaveBeenCalled();
  });

  it("shows the planning request alongside the goal even when attention owns the row indicator", async () => {
    harness.goal.mockImplementation(async method => method === "threads.plan"
      ? { plan: { mode: "plan", prompt: "Investigate the sidebar layout", providerId: "codex" } }
      : { goal: { objective: "Ship the sidebar", status: "active", timeUsedSeconds: 42, tokensUsed: 100, tokenBudget: null } });
    render(card({ thread: thread({ indicator: "runtime", hasPendingInteraction: true,
      activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 1, goals: 1 } }) }));
    expect((await screen.findByText("Investigate the sidebar layout")).closest("details")).toBeNull();
    expect(await screen.findByText("Ship the sidebar")).toBeTruthy();
    expect(screen.queryByText("1 plan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(harness.openThread).toHaveBeenCalledWith("thread-tooltip", false);
  });

  it("preserves linked pull request stacks outside the disclosure", () => {
    const pr = (number: number) => ({ number, title: `Change ${number}`, headRefName: `branch-${number}`, state: "open" as const, isDraft: false, url: `https://github.com/o/r/pull/${number}`, checks: "passing" as const });
    harness.stack = { repo: "o/r", currentBranch: "branch-2", stack: { pullRequest: pr(1), children: [{ pullRequest: pr(2), children: [] }] } };
    const openThread = vi.fn();
    render(<div onClick={openThread}>{card()}</div>);
    const stack = screen.getByLabelText("Pull request stack");
    expect(stack.closest("details")).toBeNull();
    expect(stack.querySelectorAll("a")).toHaveLength(2);
    fireEvent.click(stack.querySelector("a")!);
    expect(openThread).not.toHaveBeenCalled();
  });
});
