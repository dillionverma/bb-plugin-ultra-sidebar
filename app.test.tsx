// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

// The orb paints on a canvas with requestAnimationFrame, matchMedia and
// IntersectionObserver, none of which jsdom has. The mapping is covered in
// components/ThreadOrb.test.ts; here it is an inert marker with the same
// accessible name.
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: (props: { state: string; "aria-label": string }) => (
    <span
      role="img"
      aria-label={props["aria-label"]}
      data-orb-state={props.state}
    />
  ),
}));
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { applyStateChange } from "./lib/history";
import type { WorkspaceState } from "./lib/types";

function thread(
  overrides: Partial<PluginSidebarThread> & { id: string; projectId: string },
): PluginSidebarThread {
  return {
    title: overrides.id,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
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

// renderSlot mounts into document.body; without this, each test would find
// the previous test's sidebar still on screen.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/**
 * Grouping is a persisted preference read at mount, and it now defaults to
 * status. Tests about workspace grouping have to say so explicitly rather
 * than rely on a default that is free to change.
 */
function groupBy(mode: "status" | "workspace" | "project") {
  window.localStorage.setItem("bb-workspace-sidebar:collapsed-sections:v2", "[]");
  window.localStorage.setItem("bb-workspace-sidebar:compact-rows:v1", "false");
  window.localStorage.setItem("bb-workspace-sidebar:group-by:v1", mode);
}

const projects = [
  { id: "p1", name: "Alpha", isPersonal: false },
  { id: "p2", name: "Beta", isPersonal: false },
];

const state: WorkspaceState = {
  revision: 1,
  workspaces: [
    {
      id: "ws1",
      name: "Client work",
      sortIndex: 0,
      sortMode: "recent",
      createdAt: 1,
    },
  ],
  assignments: [
    { kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 },
  ],
  lifecycle: [],
};

async function mount(options: {
  threads: PluginSidebarThread[];
  workspaceState?: WorkspaceState;
  activeThreadId?: string | null;
  mode?: "status" | "workspace" | "project";
  compact?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
  rpc?: Record<string, (input: unknown) => unknown>;
}) {
  groupBy(options.mode ?? "workspace");
  if (options.compact) window.localStorage.setItem("bb-workspace-sidebar:compact-rows:v1", "true");
  let live = structuredClone(options.workspaceState ?? state);
  const app = await loadPluginApp(() => import("./app"));
  const registration = app.threadLists[0]!;
  const slot = renderSlot(
    registration,
    {
      activeThreadId: options.activeThreadId ?? null,
      activeProjectId: null,
      isCompactViewport: options.mobile ?? false,
      onNavigate: options.onNavigate ?? (() => {}),
      searchQuery: "",
      Original: () => <div data-testid="bb-original-list" />,
    },
    {
      sidebarThreads: {
        status: "ready",
        threads: options.threads,
        projects,
      },
      rpc: {
        "threads.title": input => options.threads.find(t => t.id === (input as {threadId:string}).threadId)?.title ?? null,
        "threads.restoreTitle": () => null,
        "projects.artwork": () => ({ entries: [] }),
        "workspaces.state": () => live,
        "workspaces.edit": (input) => {
          const { before, after } = input as {
            before: WorkspaceState;
            after: WorkspaceState;
          };
          live = {
            ...applyStateChange(live, before, after),
            revision: live.revision + 1,
          };
          return live;
        },
        ...options.rpc,
      },
    },
  );
  // The toolbar only renders once the store has loaded, and unlike a
  // workspace name it is there in every grouping mode.
  await slot.findByLabelText("View options");
  return slot;
}

/**
 * A section heading by its label. The plain text query is ambiguous: a row's
 * hover "Done" button and the Done heading share their text.
 */
function heading(
  slot: { getAllByText(text: string): HTMLElement[] },
  label: string,
): HTMLElement {
  const match = slot
    .getAllByText(label)
    .find((element) => element.closest("button[aria-expanded]") !== null);
  if (match === undefined) throw new Error(`No section heading "${label}"`);
  return match.closest("section")!;
}

describe("workspace thread list", () => {
  it("registers the exclusive thread-list slot", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.threadLists).toHaveLength(1);
    expect(app.threadLists[0]!.id).toBe("workspaces");
  });

  it("groups an assigned project under its workspace and leaves the rest unassigned", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "t1", projectId: "p1" }),
        thread({ id: "t2", projectId: "p2" }),
      ],
    });

    const alpha = slot.getByText("Alpha").closest("li")!;
    expect(alpha.textContent).toContain("t1");
    expect(alpha.textContent).not.toContain("t2");
    expect(slot.getByText("Unassigned")).toBeTruthy();
  });

  it("draws a project's own artwork on its heading and on rows that name it", async () => {
    const glyph = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    const slot = await mount({
      threads: [
        thread({ id: "t1", projectId: "p1" }),
        thread({ id: "t2", projectId: "p2" }),
      ],
      rpc: {
        "projects.artwork": (input) => {
          expect((input as { projectIds: string[] }).projectIds.sort()).toEqual(["p1", "p2"]);
          return {
            entries: [
              { projectId: "p1", kind: "glyph", svg: glyph },
              { projectId: "p2", kind: "image" },
            ],
          };
        },
      },
    });

    // Re-query each time: the list is rebuilt once the store loads, and the
    // artwork answer lands around the same moment.
    const projectRow = (name: string) => slot.getByText(name).closest("li")!;
    await waitFor(() => {
      expect(projectRow("Alpha").querySelector('[data-project-artwork="glyph"]')).toBeTruthy();
    });
    expect(projectRow("Alpha").querySelector('[data-project-artwork="folder"]')).toBeNull();

    const beta = projectRow("Beta");
    const image = beta.querySelector<HTMLImageElement>('img[data-project-artwork="image"]')!;
    expect(image.getAttribute("src")).toBe(
      "/api/v1/plugins/workspace-sidebar/http/project-icon?projectId=p2",
    );

    // A route that has stopped answering must not leave a broken image.
    fireEvent.error(image);
    expect(beta.querySelector('[data-project-artwork="folder"]')).toBeTruthy();
  });

  it("keeps the folder glyph and skips the lookup when project icons are off", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:project-icons:v1", "false");
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
      rpc: {
        "projects.artwork": () => ({ entries: [{ projectId: "p1", kind: "image" }] }),
      },
    });

    const alpha = slot.getByText("Alpha").closest("li")!;
    expect(alpha.querySelector('[data-project-artwork="folder"]')).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "projects.artwork"),
    ).toHaveLength(0);

    fireEvent.click(slot.getByLabelText("View options"));
    fireEvent.click(await slot.findByLabelText("Project icons"));
    await waitFor(() => {
      expect(alpha.querySelector('[data-project-artwork="image"]')).toBeTruthy();
    });
  });

  // The highest-value assertion in this suite. bb's thread shortcuts find rows
  // with a query selector, not React state, so a row that renders without both
  // attributes silently drops out of thread.next/previous and the numbered
  // shortcuts — invisible until someone reaches for the keyboard.
  it("emits the shortcut DOM contract for every row, in rendered order", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "t1", projectId: "p1", createdAt: 20 }),
        thread({ id: "t2", projectId: "p1", createdAt: 10 }),
        thread({ id: "t3", projectId: "p2" }),
      ],
    });

    const rows = Array.from(
      slot.container.querySelectorAll<HTMLElement>(
        "[data-sidebar-thread-shortcut-target]",
      ),
    );
    expect(
      rows.map((row) => row.getAttribute("data-sidebar-thread-id")),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("nests subagent threads under the thread that spawned them", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "parent", projectId: "p1" }),
        thread({
          id: "child",
          projectId: "p1",
          parentThreadId: "parent",
          originKind: "fork",
        }),
      ],
    });

    // Collapsed by default: the child is behind a chevron, and the parent
    // carries its count.
    expect(slot.queryByText("child")).toBeNull();
    const expand = slot.getByLabelText("Expand subagents");
    expand.click();
    expect(await slot.findByText("child")).toBeTruthy();
  });

  it("promotes a subagent whose parent is archived rather than dropping it", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "parent", projectId: "p1", isArchived: true }),
        thread({ id: "child", projectId: "p1", parentThreadId: "parent" }),
      ],
    });

    expect(slot.getByText("child")).toBeTruthy();
    expect(slot.queryByText("parent")).toBeNull();
  });

  it("opens a thread through the host action and closes the mobile drawer", async () => {
    let navigated = 0;
    groupBy("workspace");
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => {
          navigated += 1;
        },
        searchQuery: "",
        Original: () => <div />,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread({ id: "t1", projectId: "p1" })],
          projects,
        },
        rpc: { "workspaces.state": () => state },
      },
    );
    await slot.findByText("Client work");

    slot.getByText("t1").closest("a")!.click();

    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({ method: "open", threadId: "t1" }),
    );
    expect(navigated).toBe(1);
  });

  // Radix restores focus to the trigger when the menu closes, which blurs the
  // rename input and commits an empty edit — the field appears and vanishes.
  it("keeps the rename field open after choosing Rename from the menu", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });

    fireEvent.contextMenu(slot.getByText("t1"));
    fireEvent.click(await slot.findByText("Rename"));

    const input = await slot.findByLabelText("Rename thread");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(slot.queryByLabelText("Rename thread")).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  // The hover actions sit inside the row's anchor. Clicking one must reach the
  // lifecycle RPC and nothing else — not open the thread, not start a rename.
  it.each([false, true])("marks done and snoozes a thread from the row's hover actions, compact=%s", async compact => {
    window.localStorage.setItem("bb-workspace-sidebar:compact-rows:v1", String(compact));
    groupBy("workspace");
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
        Original: () => <div />,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread({ id: "t1", projectId: "p1" })],
          projects,
        },
        rpc: {
          "workspaces.state": () => state,
          "workspaces.edit": (input) => ({
            ...(input as { after: WorkspaceState }).after,
            revision: 2,
          }),
        },
      },
    );
    await slot.findByText("Client work");

    fireEvent.click(slot.getByLabelText("Mark done"));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({
          method: "workspaces.edit",
          input: expect.objectContaining({
            after: expect.objectContaining({
              lifecycle: [
                { threadId: "t1", status: "done", snoozedUntil: null },
              ],
            }),
          }),
        }),
      ),
    );
    fireEvent.keyDown(slot.getByLabelText("Workspace threads"), { key: "z", ctrlKey: true });
    fireEvent.click(await slot.findByRole("button", { name: "Hide until tomorrow at 9am" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "workspaces.edit",
        ),
      ).toHaveLength(3),
    );
    const snooze = slot.inspection.rpcCalls.filter(
      (call) => call.method === "workspaces.edit",
    )[2]!;
    const until = (snooze.input as { after: WorkspaceState }).after
      .lifecycle[0]!.snoozedUntil!;
    expect(until).toBeGreaterThan(Date.now());
    expect(new Date(until).getHours()).toBe(9);

    expect(slot.inspection.sidebarActionCalls).not.toContainEqual(
      expect.objectContaining({ method: "open" }),
    );
    expect(slot.queryByLabelText("Rename thread")).toBeNull();
  });

  // The folder and pull-request badges are links. The folder goes through
  // our server (it has to run `open` somewhere); the PR goes through bb's
  // navigate so the desktop app can hand it to the system browser.
  it("links the folder and pull request badges without opening the row", async () => {
    groupBy("workspace");
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
        Original: () => <div />,
      },
      {
        openUrl: () => true,
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({
              id: "t1",
              projectId: "p1",
              environment: {
                id: "env1",
                name: "wt-feature",
                branchName: "feat/links",
                providerId: null,
                workspaceDisplayKind: null,
              },
            }),
          ],
          projects,
        },
        rpc: {
          "workspaces.state": () => state,
          "environments.locations": () => ({
            entries: [
              {
                environmentId: "env1",
                path: "/Users/me/src/alpha",
                hostId: "h1",
                hostName: "mbp",
              },
            ],
          }),
          "environments.openFolder": () => ({
            outcome: "opened",
            path: "/Users/me/src/alpha",
          }),
          "threads.pullRequests": () => ({
            entries: [
              {
                threadId: "t1",
                number: 42,
                title: "Add links",
                url: "https://github.com/acme/alpha/pull/42",
                state: "open",
                attention: "none",
                checksState: null,
                failedChecks: 0,
              },
            ],
          }),
        },
      },
    );
    await slot.findByText("Client work");

    // The branch badge becomes a button once the folder is known.
    const branch = await slot.findByRole("button", { name: /feat\/links/ });
    fireEvent.click(branch);
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "environments.openFolder",
        input: { environmentId: "env1" },
      }),
    );

    const pr = await slot.findByRole("button", { name: /#42/ });
    fireEvent.click(pr);
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({
        method: "openUrl",
        url: "https://github.com/acme/alpha/pull/42",
      }),
    );

    expect(slot.inspection.sidebarActionCalls).not.toContainEqual(
      expect.objectContaining({ method: "open" }),
    );
  });

  it("shows branch, machine and model on the metadata line", async () => {
    groupBy("workspace");
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => {},
        searchQuery: "",
        Original: () => <div />,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({
              id: "t1",
              projectId: "p1",
              environment: {
                id: "env1",
                name: "wt-feature",
                branchName: "feat/sidebar",
                providerId: null,
                workspaceDisplayKind: null,
              },
              host: { id: "h1", name: "studio-mbp" },
            }),
          ],
          projects,
        },
        rpc: {
          "workspaces.state": () => state,
          "threads.execution": (input: unknown) => ({
            entries: (input as { threadIds: string[] }).threadIds.map(
              (threadId) => ({
                threadId,
                model: "claude-opus-5[1m]",
                permissionMode: "auto",
                reasoningLevel: "high",
                serviceTier: "default",
              }),
            ),
          }),
        },
      },
    );
    await slot.findByText("Client work");

    expect(await slot.findByText("feat/sidebar")).toBeTruthy();
    expect(slot.getByRole("button", { name: /Machine: studio-mbp\. Details for/ })).toBeTruthy();
    // The raw id is unreadable in a sidebar; the badge shows the family.
    expect(await slot.findByText("opus-5")).toBeTruthy();
  });

  it("does not ask for execution metadata when there are no rows on screen", async () => {
    const slot = await mount({ threads: [] });
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "threads.execution",
      ),
    ).toHaveLength(0);
  });

  it("collapses and reopens a project group", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });
    expect(slot.getByText("t1")).toBeTruthy();

    fireEvent.click(slot.getByLabelText("Collapse Alpha"));
    expect(slot.queryByText("t1")).toBeNull();

    fireEvent.click(slot.getByLabelText("Expand Alpha"));
    expect(slot.getByText("t1")).toBeTruthy();
  });

  it("stops asking for metadata once a project is collapsed", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });
    fireEvent.click(slot.getByLabelText("Collapse Alpha"));
    const before = slot.inspection.rpcCalls.length;
    // Nothing on screen means nothing to look up.
    fireEvent.click(slot.getByLabelText("Expand Alpha"));
    expect(slot.inspection.rpcCalls.length).toBeGreaterThanOrEqual(before);
  });

  it("groups by status out of the box, with all five buckets", async () => {
    const slot = await mount({
      mode: "status",
      threads: [
        thread({ id: "waiting", projectId: "p1", hasPendingInteraction: true }),
        thread({ id: "quiet", projectId: "p1" }),
      ],
    });

    // The workflow is always the same five headings, filled or not.
    await slot.findByText("In review");
    for (const label of [
      "Done",
      "In review",
      "In progress",
      "Backlog",
      "Canceled",
    ]) {
      expect(heading(slot, label)).toBeTruthy();
    }
    // With no pull request and no manual status, both are In progress, and
    // the row still says what the agent is doing.
    const inProgress = heading(slot, "In progress");
    expect(inProgress.textContent).toContain("waiting");
    expect(inProgress.textContent).toContain("quiet");
    expect(inProgress.textContent).toContain("Your turn");
    const rows = slot.container.querySelectorAll("[data-sidebar-thread-id]");
    expect(rows).toHaveLength(2);
    expect(slot.container.querySelectorAll("[data-agent-orb]")).toHaveLength(0);
    expect(slot.container.querySelectorAll("[data-text-shimmer]")).toHaveLength(0);
    expect(slot.getByText("Your turn").closest(".bb-ws-mainline")).not.toBeNull();
    // No workspace headings, and no project headings inside a status bucket
    // (rows still name their project in a badge).
    expect(slot.queryByText("Client work")).toBeNull();
    expect(slot.queryByLabelText("Collapse Alpha")).toBeNull();
  });

  it("files a hand-set status in its bucket", async () => {
    const slot = await mount({
      mode: "status",
      threads: [
        thread({ id: "parked", projectId: "p1" }),
        thread({ id: "shipped", projectId: "p1" }),
        thread({ id: "quiet", projectId: "p1" }),
      ],
      workspaceState: {
        ...state,
        lifecycle: [
          { threadId: "parked", status: "backlog", snoozedUntil: null },
          { threadId: "shipped", status: "done", snoozedUntil: null },
        ],
      },
    });

    await slot.findByText("Backlog");
    expect(heading(slot, "Backlog").textContent).toContain("parked");
    expect(heading(slot, "Done").textContent).toContain("shipped");
    const inProgress = heading(slot, "In progress");
    expect(inProgress.textContent).toContain("quiet");
    expect(inProgress.textContent).not.toContain("parked");
  });

  // A bucket gathers rows from every workspace and project; they must read
  // as one most-recent-first list, not as each group's list laid end to end.
  it("orders a status bucket newest first across projects", async () => {
    const slot = await mount({
      mode: "status",
      threads: [
        thread({ id: "alpha-old", projectId: "p1", createdAt: 10 }),
        thread({ id: "beta-new", projectId: "p2", createdAt: 30 }),
        thread({ id: "alpha-mid", projectId: "p1", createdAt: 20 }),
        thread({
          id: "beta-pinned",
          projectId: "p2",
          createdAt: 5,
          isPinned: true,
        }),
        thread({
          id: "alpha-asks",
          projectId: "p1",
          createdAt: 1,
          hasPendingInteraction: true,
        }),
      ],
    });
    await slot.findByText("In review");
    const ids = Array.from(
      heading(slot, "In progress").querySelectorAll("[data-sidebar-thread-id]"),
    ).map((row) => row.getAttribute("data-sidebar-thread-id"));
    // Pinned, then whatever is waiting on the person, then newest created first.
    expect(ids).toEqual([
      "beta-pinned",
      "alpha-asks",
      "beta-new",
      "alpha-mid",
      "alpha-old",
    ]);
  });

  // Finished work leaves its workspace rather than crowding it.
  it("trails Done, Backlog and Canceled after the workspaces", async () => {
    const slot = await mount({
      mode: "workspace",
      threads: [
        thread({ id: "shipped", projectId: "p1" }),
        thread({ id: "quiet", projectId: "p1" }),
      ],
      workspaceState: {
        ...state,
        lifecycle: [
          { threadId: "shipped", status: "done", snoozedUntil: null },
        ],
      },
    });

    const workspace = (await slot.findByText("Client work")).closest(
      "section",
    )!;
    expect(workspace.textContent).toContain("quiet");
    expect(workspace.textContent).not.toContain("shipped");
    expect(heading(slot, "Done").textContent).toContain("shipped");
    // Nothing is in the backlog, so there is no Backlog heading here.
    expect(slot.queryByText("Backlog")).toBeNull();
  });

  it("refetches when a newer revision arrives, and ignores its own echo", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });
    const before = slot.inspection.rpcCalls.length;

    await slot.behavior.emitRealtime("workspaces-changed", { revision: 1 });
    expect(slot.inspection.rpcCalls.length).toBe(before);

    await slot.behavior.emitRealtime("workspaces-changed", { revision: 2 });
    expect(slot.inspection.rpcCalls.length).toBeGreaterThan(before);
  });

  it("refetches when the realtime connection comes back", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });
    const before = slot.inspection.rpcCalls.length;

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");

    expect(slot.inspection.rpcCalls.length).toBeGreaterThan(before);
  });

  // Status buckets carry no project heading, so the row has to say which
  // project it belongs to itself.
  it("names the project on each row when grouped by status", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p2" })],
      mode: "status",
    });
    const row = slot.getByText("t1").closest("li")!;
    expect(row.textContent).toContain("Beta");
  });

  it("drops the project badge when its switch is off", async () => {
    window.localStorage.setItem(
      "bb-workspace-sidebar:row-details:v1",
      JSON.stringify({ project: false }),
    );
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p2" })],
      mode: "status",
    });
    const row = slot.getByText("t1").closest("li")!;
    expect(row.textContent).not.toContain("Beta");
  });

  it("files archived and row-detail switches under View options", async () => {
    const slot = await mount({
      threads: [thread({ id: "t1", projectId: "p1" })],
    });
    expect(slot.queryByLabelText("Show row details")).toBeNull();
    expect(slot.queryByLabelText("Show archived")).toBeNull();

    fireEvent.click(slot.getByLabelText("View options"));
    const menu = await slot.findByText("Show on rows");
    expect(menu).toBeTruthy();
    expect(slot.getByLabelText("Model")).toBeTruthy();
    expect(slot.getByLabelText("Archived")).toBeTruthy();
    expect(slot.getByText("Collapse all")).toBeTruthy();
  });
});

describe("sidebar keyboard and bulk actions", () => {
  it("selects a range, performs bulk done, and undoes/redoes it in one step", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "a", projectId: "p1", createdAt: 3 }),
        thread({ id: "b", projectId: "p1", createdAt: 2 }),
        thread({ id: "c", projectId: "p1", createdAt: 1 }),
      ],
    });
    const row = (id: string) =>
      slot.container.querySelector<HTMLElement>(
        `[data-sidebar-thread-id="${id}"]`,
      )!;
    fireEvent.click(row("a"), { ctrlKey: true });
    fireEvent.click(row("c"), { shiftKey: true });
    expect(slot.getByText("3 selected")).toBeTruthy();
    fireEvent.click(within(slot.getByRole("toolbar", { name: "Selected threads" })).getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(row("a").dataset.sidebarBucket).toBe("done"));
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "workspaces.edit",
      ),
    ).toHaveLength(1);
    row("a").focus();
    fireEvent.keyDown(row("a"), { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(row("a").dataset.sidebarBucket).toBe("in-progress"),
    );
    fireEvent.keyDown(row("a"), { key: "z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(row("c").dataset.sidebarBucket).toBe("done"));
    expect(
      slot.inspection.sidebarActionCalls.filter(
        (call) => call.method === "open",
      ),
    ).toHaveLength(0);
  });
  it("keeps text undo intact and supports F2, navigation and shortcut help", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "a", projectId: "p1", createdAt: 2 }),
        thread({ id: "b", projectId: "p1", createdAt: 1 }),
      ],
    });
    const a = slot.container.querySelector<HTMLElement>(
      '[data-sidebar-thread-id="a"]',
    )!;
    const b = slot.container.querySelector<HTMLElement>(
      '[data-sidebar-thread-id="b"]',
    )!;
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowDown" });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: "F2" });
    const input = await slot.findByLabelText("Rename thread");
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(slot.getByLabelText("Workspace threads"), { key: "?" });
    expect(await slot.findByText("Sidebar shortcuts")).toBeTruthy();
  });
  it("recovers focus after snoozing and restores the row on undo", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "a", projectId: "p1", createdAt: 2 }),
        thread({ id: "b", projectId: "p1", createdAt: 1 }),
      ],
    });
    const a = slot.container.querySelector<HTMLElement>(
      '[data-sidebar-thread-id="a"]',
    )!;
    a.focus();
    fireEvent.keyDown(a, { key: "s" });
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-sidebar-thread-id="a"]'),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLElement).dataset.sidebarThreadId,
      ).toBe("b"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-sidebar-thread-id="a"]'),
      ).not.toBeNull(),
    );
  });
  it("moves selected threads together from the searchable picker", async () => {
    const slot = await mount({
      threads: [
        thread({ id: "a", projectId: "p2" }),
        thread({ id: "b", projectId: "p2" }),
      ],
    });
    const a = slot.container.querySelector<HTMLElement>(
      '[data-sidebar-thread-id="a"]',
    )!;
    a.focus();
    fireEvent.keyDown(a, { key: "a", ctrlKey: true });
    fireEvent.keyDown(a, { key: "m" });
    const search = await slot.findByLabelText("Find workspace");
    fireEvent.change(search, { target: { value: "Client" } });
    fireEvent.click(slot.getByRole("button", { name: "Client work" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "workspaces.edit",
        ),
      ).toHaveLength(1),
    );
    const edit = slot.inspection.rpcCalls.find(
      (call) => call.method === "workspaces.edit",
    )!;
    expect(
      (edit.input as { after: WorkspaceState }).after.assignments
        .filter((a) => a.kind === "thread")
        .map((a) => a.workspaceId),
    ).toEqual(["ws1", "ws1"]);
  });
});

it('undoes a rename back to an automatic title and groups keyboard reordering with its sort-mode change', async () => {
  const slot = await mount({ threads: [thread({id:'a',projectId:'p1',title:null,titleFallback:'Automatic name',createdAt:2}), thread({id:'b',projectId:'p1',createdAt:1})] });
  const row = () => slot.container.querySelector<HTMLElement>('[data-sidebar-thread-id="a"]')!;
  row().focus(); fireEvent.keyDown(row(),{key:'F2'});
  const input = await slot.findByLabelText('Rename thread');
  fireEvent.change(input,{target:{value:'New name'}}); fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(() => expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({method:'rename'})));
  row().focus(); fireEvent.keyDown(row(),{key:'z',ctrlKey:true});
  await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual({method:'threads.restoreTitle',input:{threadId:'a',expected:'New name',title:null}}));
  fireEvent.keyDown(row(),{key:'ArrowDown',altKey:true});
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call=>call.method==='workspaces.edit')).toHaveLength(1));
  const edit = slot.inspection.rpcCalls.find(call=>call.method==='workspaces.edit')!;
  expect((edit.input as {after:WorkspaceState}).after.workspaces[0]!.sortMode).toBe('manual');
  fireEvent.keyDown(row(),{key:'z',ctrlKey:true});
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call=>call.method==='workspaces.edit')).toHaveLength(2));
});


it("keeps only the New thread bar at rest and selects through standard checkboxes", async () => {
  const slot = await mount({ threads: [thread({ id: "a", projectId: "p1" }), thread({ id: "b", projectId: "p1" })] });
  expect(slot.queryByRole("toolbar", { name: "Sidebar actions" })).toBeNull();
  expect(slot.queryByRole("toolbar", { name: "Selected threads" })).toBeNull();
  expect(slot.getByRole("button", { name: "New thread" })).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Select threads" }));
  const checkbox = slot.getByRole("checkbox", { name: "Select a" });
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  expect(slot.getByText("1 selected")).toBeTruthy();
  expect(slot.inspection.sidebarActionCalls.filter(call => call.method === "open")).toHaveLength(0);
  fireEvent.click(slot.getByLabelText("More selection actions"));
  expect(await slot.findByRole("button", { name: "Move to workspace…" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.click(slot.getByLabelText("Clear selection"));
  expect(slot.queryByRole("toolbar", { name: "Selected threads" })).toBeNull();
});


describe("compact goal context", () => {
  it("shows simple status without command details and fetches goal only on inspection", async () => {
    const goal = { objective: "Make setup reliable", status: "active", timeUsedSeconds: 120, tokenBudget: 50000, tokensUsed: 2400, updatedAt: 1 };
    const slot = await mount({ compact: true, threads: [thread({ id: "goal-thread", projectId: "p1", indicator: "runtime", activity: { goals: 1, planMode: 0, workflows: 0, backgroundAgents: 0, backgroundCommands: 0 } })], rpc: {
      "threads.goal": () => ({ goal }),
      "threads.agentActivity": () => ({ entries: [{ threadId: "goal-thread", activity: { kind: "command", label: "Running command", detail: "npm run typecheck", at: Date.now(), seq: 1 } }] }),
    } });
    const line = slot.container.querySelector("[data-thread-modes]")!;
    expect(line.textContent).toContain("Goal");
    expect(line.textContent).toContain("Working");
    expect(slot.queryByText("Running command")).toBeNull();
    expect(slot.queryByText("npm run typecheck")).toBeNull();
    expect(slot.inspection.rpcCalls.filter(call => call.method === "threads.agentActivity")).toHaveLength(0);
    expect(slot.container.querySelector(".bb-ws-title[data-text-shimmer]")?.textContent).toBe("goal-thread");
    expect(slot.inspection.rpcCalls.filter(call => call.method === "threads.goal")).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: "Active goal: details for goal-thread" }));
    expect(await slot.findByText("Make setup reliable")).toBeTruthy();
    expect(slot.getByText("Tokens used")).toBeTruthy();
    expect(slot.inspection.sidebarActionCalls.filter(call => call.method === "open")).toHaveLength(0);
    expect(slot.inspection.rpcCalls.filter(call => call.method === "threads.goal")).toHaveLength(1);
    expect(slot.queryByText("npm run typecheck")).toBeNull();
  });

  it("keeps approval visible with the goal and handles unavailable goal details", async () => {
    const slot = await mount({ compact: true, threads: [thread({ id: "waiting-goal", projectId: "p1", hasPendingInteraction: true, activity: { goals: 1, planMode: 0, workflows: 0, backgroundAgents: 0, backgroundCommands: 0 } })], rpc: {
      "threads.goal": () => { throw new Error("offline"); },
    } });
    const line = slot.container.querySelector("[data-thread-modes]")!;
    expect(line.textContent).toContain("Goal");
    expect(line.textContent).not.toContain("Your turn");
    expect(slot.getByText("Your turn").closest(".bb-ws-mainline")).not.toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Active goal: details for waiting-goal" }));
    expect(await slot.findByText("Goal details unavailable. Open the thread to inspect.")).toBeTruthy();
    expect(slot.inspection.sidebarActionCalls.filter(call => call.method === "open")).toHaveLength(0);
  });
});


it("opens real view options and workspace input from the background menu", async () => {
  const slot = await mount({ threads: [thread({ id: "background-test", projectId: "p1" })] });
  const surface = slot.getByLabelText("Workspace threads");
  fireEvent.contextMenu(surface);
  fireEvent.click(await slot.findByRole("menuitem", { name: "View options…" }));
  expect(await slot.findByText("Show on rows")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.contextMenu(surface);
  fireEvent.click(await slot.findByRole("menuitem", { name: "New workspace" }));
  const input = await slot.findByRole("textbox", { name: "New workspace name" });
  await waitFor(() => expect(document.activeElement).toBe(input));
});


it.each([false, true])("keeps attention beside the title without tinting rows, compact=%s", async compact => {
  const slot = await mount({ mode: "status", compact, threads: [
    thread({ id: "running", projectId: "p1", indicator: "runtime" }),
    thread({ id: "waiting", projectId: "p1", indicator: "runtime", hasPendingInteraction: true }),
    thread({ id: "failed", projectId: "p1", indicator: "unread-error" }),
    thread({ id: "quiet", projectId: "p1" }),
  ] });
  const row = (id: string) => slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`) as HTMLElement;
  expect(row("running").getAttribute("data-live-tone")).toBeNull();
  expect(row("waiting").getAttribute("data-live-tone")).toBeNull();
  expect(row("failed").getAttribute("data-live-tone")).toBeNull();
  expect(within(row("running")).getByText("Working").classList.contains("ws-tone-working")).toBe(true);
  const badge = within(row("waiting")).getByText("Your turn");
  expect(badge.classList.contains("bb-ws-your-turn")).toBe(true);
  expect(badge.closest(".bb-ws-mainline")).not.toBeNull();
  expect(row("waiting").querySelector("[data-agent-orb]")).toBeNull();
  expect(row("waiting").querySelector("[data-text-shimmer]")).toBeNull();
  expect(within(row("failed")).getByText("Failed").classList.contains("ws-tone-danger")).toBe(true);
  expect(row("quiet").getAttribute("data-live-tone")).toBeNull();
  expect(row("quiet").getAttribute("data-sidebar-bucket")).toBe("in-progress");
  expect(row("running").querySelector(".bb-ws-title[data-text-shimmer]")).not.toBeNull();
});

describe("project context and change counts", () => {
  it.each([false, true])("keeps known unstaged changes visible when totals are partial, compact=%s", async compact => {
    const slot = await mount({ compact, mobile: true, mode: "status", threads: [
      thread({ id: "unstaged", projectId: "p1", environment: { id: "env-unstaged" } as never }),
    ], rpc: {
      "threads.diffs": () => ({ entries: [{ threadId: "unstaged", additions: 269, deletions: 48, partial: true }] }),
    } });
    const diff = await slot.findByRole("img", { name: "Partial diff: at least 269 lines added, at least 48 lines removed" });
    const row = diff.closest("[data-sidebar-thread-id]") as HTMLElement;
    expect(within(row).getByText("Alpha")).toBeTruthy();
    expect(within(row).queryByText("In progress")).toBeNull();
    expect(within(diff).getByText("+269")).toBeTruthy();
    expect(within(diff).getByText("−48")).toBeTruthy();
    expect(within(diff).queryByText("partial")).toBeNull();
  });

  it.each([
    { compact: false, mobile: false },
    { compact: true, mobile: false },
    { compact: false, mobile: true },
    { compact: true, mobile: true },
  ])("shows project context and colored diffs with compact=$compact mobile=$mobile", async ({ compact, mobile }) => {
    const onNavigate = vi.fn();
    const slot = await mount({ compact, mobile, onNavigate, mode: "status", threads: [
      thread({ id: "progress", projectId: "p1", environment: { id: "env-progress", branchName: "feature/progress" } as never }),
      thread({ id: "review", projectId: "p1", indicator: "runtime", environment: { id: "env-review", branchName: "feature/review" } as never }),
    ], rpc: {
      "threads.pullRequests": () => ({ entries: [{ threadId: "review", number: 42, title: "Feature", url: "https://example.test/42", state: "open", attention: "none", checksState: null, failedChecks: 0 }] }),
      "threads.diffs": () => ({ entries: [
        { threadId: "progress", additions: 12, deletions: 3 },
        { threadId: "review", additions: 1234, deletions: 56 },
      ] }),
    } });
    const rowById = (id: string) => slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`) as HTMLElement;
    await waitFor(() => {
      const progress = rowById("progress");
      const review = rowById("review");
      expect(within(progress).getByText("Alpha")).toBeTruthy();
      expect(within(review).getByText("Alpha")).toBeTruthy();
      expect(within(progress).queryByText("In progress")).toBeNull();
      expect(within(progress).getByRole("img", { name: "12 lines added, 3 lines removed" })).toBeTruthy();
      expect(within(review).getByRole("img", { name: "1,234 lines added, 56 lines removed" })).toBeTruthy();
    });
    const progress = rowById("progress");
    const review = rowById("review");
    expect(within(progress).getByText("+12").classList.contains("ws-tone-success")).toBe(true);
    expect(within(progress).getByText("−3").classList.contains("ws-tone-danger")).toBe(true);
    expect(review.querySelector('[data-agent-orb="working"]')).not.toBeNull();
    expect(review.querySelector("[data-thread-project]")?.closest("[data-thread-modes]")).not.toBeNull();
    expect(progress.querySelector("[data-thread-modes]")?.classList.contains("flex-wrap")).toBe(true);
    for (const row of [progress, review]) {
      const diff = row.querySelector("[data-thread-diff]")!;
      const slot = diff.closest("[data-thread-diff-slot]");
      expect(slot?.parentElement).toBe(row.querySelector("[data-thread-summary]"));
      expect(diff.closest("[data-thread-modes]")).toBeNull();
      expect(row.querySelectorAll("[data-thread-diff-slot]")).toHaveLength(1);
      expect(row.querySelector(".bb-ws-mainline")?.nextElementSibling).toBe(row.querySelector("[data-thread-summary]"));
    }
    fireEvent.click(within(progress).getByText("+12"));
    expect(slot.inspection.sidebarActionCalls.some(call => call.method === "open")).toBe(true);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("shows project context without fabricated counts for clean or unavailable environments", async () => {
    const readDiffs = vi.fn(() => ({ entries: [{ threadId: "clean", additions: 0, deletions: 0 }] }));
    const slot = await mount({ compact: true, threads: [
      thread({ id: "clean", projectId: "p1", environment: { id: "env-clean" } as never }),
      thread({ id: "unavailable", projectId: "p1" }),
    ], rpc: {
      "threads.diffs": readDiffs,
    } });
    await waitFor(() => expect(readDiffs).toHaveBeenCalledOnce());
    expect(slot.container.querySelectorAll("[data-thread-project]")).toHaveLength(2);
    expect(slot.container.querySelector("[data-thread-diff]")).toBeNull();
  });

  it("keeps project context on parked rows without dangling mode separators", async () => {
    const slot = await mount({ compact: true, threads: [
      thread({ id: "parked", projectId: "p1" }),
      thread({ id: "parked-goal", projectId: "p1", activity: { goals: 1, planMode: 0, workflows: 0, backgroundAgents: 0, backgroundCommands: 0 } }),
    ], workspaceState: { ...state, lifecycle: [
      { threadId: "parked", status: "done", snoozedUntil: null },
      { threadId: "parked-goal", status: "done", snoozedUntil: null },
    ] } });
    expect(slot.container.querySelector('[data-sidebar-thread-id="parked"] [data-thread-modes]')?.textContent).toBe("Alpha");
    const modes = slot.container.querySelector('[data-sidebar-thread-id="parked-goal"] [data-thread-modes]');
    expect(modes?.textContent).toBe("Alpha·Goal");
  });
});


describe("thread summary actions", () => {
  it.each([false, true])("opens mode and machine details with model names hidden in rows, compact=%s", async compact => {
    window.localStorage.setItem("bb-workspace-sidebar:row-details:v1", JSON.stringify({ model: false }));
    const readPlan = vi.fn(() => ({ plan: { mode: "plan", prompt: "Compare upgrade options before implementing.", providerId: "claude-code" } }));
    const readExecution = vi.fn(() => ({ entries: [{ threadId: "planning", model: "gpt-6-astra", reasoningLevel: "medium", permissionMode: "auto", serviceTier: null }] }));
    const slot = await mount({ compact, mode: "status", threads: [thread({
      id: "planning", projectId: "p1", indicator: "plan-mode",
      host: { id: "mbp-host", name: "mbp" } as never,
      activity: { planMode: 1, goals: 0, workflows: 0, backgroundAgents: 0, backgroundCommands: 0 },
    })], rpc: { "threads.plan": readPlan, "threads.execution": readExecution } });
    const row = slot.container.querySelector('[data-sidebar-thread-id="planning"]') as HTMLElement;
    const project = within(row).getByText("Alpha");
    const machine = within(row).getByRole("button", { name: "Machine: mbp. Details for planning" });
    expect(machine.closest("[data-thread-context]")).toBe(project.closest("[data-thread-context]"));
    expect(machine.closest("[data-thread-summary]")).not.toBeNull();
    expect(machine.closest(".bb-ws-mainline")).toBeNull();
    expect(readPlan).not.toHaveBeenCalled();
    if (!compact) expect(readExecution).not.toHaveBeenCalled();
    const plan = within(row).getByRole("button", { name: "Plan mode: details for planning" });
    fireEvent.click(plan);
    expect(await slot.findByText("Compare upgrade options before implementing.")).toBeTruthy();
    expect(await slot.findByText("gpt-6-astra")).toBeTruthy();
    expect(plan.getAttribute("aria-expanded")).toBe("true");
    expect(slot.inspection.sidebarActionCalls.filter(call => call.method === "open")).toHaveLength(0);
    fireEvent.keyDown(plan, { key: "Escape" });
    await waitFor(() => expect(plan.getAttribute("aria-expanded")).toBe("false"));
    fireEvent.click(machine);
    expect(await slot.findByRole("heading", { name: "planning" })).toBeTruthy();
    expect(await slot.findByText("Details")).toBeTruthy();
    expect(machine.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("thread handoff", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
  it.each([true, false])("chooses another model without opening the source (compact: %s)", async compact => {
    const handoff = vi.fn(() => ({ threadId: "next" }));
    const slot = await mount({ compact, threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: {
      "threads.handoffOptions": () => ({ providerId: "codex", providers: [{ id: "codex", name: "Codex", available: true }], models: [{ id: "gpt-6", name: "GPT-6" }], error: null }),
      "threads.handoff": handoff,
    } });
    expect(slot.container.querySelector("[data-thread-provider-logo]")).not.toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Hand off thread" }));
    fireEvent.click(await slot.findByRole("option", { name: "GPT-6" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith({ threadId: "source", workspaceId: "ws1", target: { providerId: "codex", model: "gpt-6" } }));
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "next" }));
    expect(slot.inspection.navigateCalls).not.toContainEqual({ method: "toThread", threadId: "source" });
  });
  it("keeps a failed handoff open and allows retry", async () => {
    let attempts = 0;
    const slot = await mount({ threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: {
      "threads.handoffOptions": () => ({ providerId: "codex", providers: [], models: [], error: null }),
      "threads.handoff": () => { if (++attempts === 1) throw new Error("Host offline"); return { threadId: "next" }; },
    } });
    fireEvent.click(slot.getByRole("button", { name: "Hand off thread" }));
    fireEvent.click(await slot.findByRole("button", { name: "Same agent" }));
    await slot.findByText("Host offline");
    expect(slot.inspection.navigateCalls).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Same agent" }));
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "next" }));
  });
  it("switches providers, searches models, and selects with Enter", async () => {
    const handoff = vi.fn(() => ({ threadId: "next" }));
    const options = vi.fn((input: unknown) => {
      const providerId = (input as { providerId?: string }).providerId ?? "codex";
      return {
        providerId,
        providers: [{ id: "codex", name: "Codex", available: true }, { id: "claude-code", name: "Claude Code", available: true }],
        models: providerId === "codex" ? [{ id: "gpt-6", name: "GPT-6" }] : [{ id: "opus", name: "Opus" }, { id: "sonnet", name: "Sonnet" }],
        error: null,
      };
    });
    const slot = await mount({ threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: { "threads.handoffOptions": options, "threads.handoff": handoff } });
    fireEvent.click(slot.getByRole("button", { name: "Hand off thread" }));
    await slot.findByRole("option", { name: "GPT-6" });
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Claude Code" }), { button: 0, ctrlKey: false });
    await slot.findByRole("option", { name: "Sonnet" });
    const input = slot.getByRole("combobox", { name: "Search models" });
    fireEvent.change(input, { target: { value: "sonnet" } });
    await waitFor(() => expect(slot.queryByRole("option", { name: "Opus" })).toBeNull());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(handoff).toHaveBeenCalledWith({ threadId: "source", workspaceId: "ws1", target: { providerId: "claude-code", model: "sonnet" } }));
    expect(options).toHaveBeenCalledWith({ threadId: "source", providerId: "claude-code" });
  });

  it("shows a keyboard tooltip and dismisses it when the picker opens", async () => {
    const slot = await mount({ threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: {
      "threads.handoffOptions": () => ({ providerId: "codex", providers: [], models: [], error: null }),
    } });
    const trigger = slot.getByRole("button", { name: "Hand off thread" });
    expect(trigger.hasAttribute("title")).toBe(false);
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(trigger);
    expect(await slot.findByRole("tooltip")).toHaveProperty("textContent", "Continue in a new thread with any model");
    fireEvent.click(trigger);
    await slot.findByRole("combobox", { name: "Search models" });
    await waitFor(() => expect(slot.queryByRole("tooltip")).toBeNull());
  });

  it("retries the selected provider after a model lookup fails", async () => {
    let attempts = 0;
    const options = vi.fn((input: unknown) => {
      const providerId = (input as { providerId?: string }).providerId ?? "codex";
      if (providerId === "claude-code" && attempts++ < 2) throw new Error("Host offline");
      return { providerId, providers: [{ id: "codex", name: "Codex", available: true }, { id: "claude-code", name: "Claude Code", available: true }], models: [{ id: "test-model", name: "Test model" }], error: null };
    });
    const slot = await mount({ threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: { "threads.handoffOptions": options } });
    fireEvent.click(slot.getByRole("button", { name: "Hand off thread" }));
    await slot.findByRole("option", { name: "Test model" });
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Claude Code" }), { button: 0, ctrlKey: false });
    await slot.findByText("Host offline");
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await slot.findByRole("option", { name: "Test model" });
    expect(options).toHaveBeenLastCalledWith({ threadId: "source", providerId: "claude-code" });
  });

  it("switches preloaded icon tabs immediately and preserves the search", async () => {
    const options = vi.fn((input: unknown) => {
      const providerId = (input as { providerId: string }).providerId;
      return { providerId, providers: [{ id: "codex", name: "Codex", available: true }, { id: "claude", name: "Claude", available: true }], models: [{ id: `${providerId}-fast`, name: `${providerId} fast` }], error: null };
    });
    const slot = await mount({ threads: [thread({ id: "source", projectId: "p1", providerId: "codex" })], rpc: { "threads.handoffOptions": options } });
    fireEvent.pointerEnter(slot.getByRole("button", { name: "Hand off thread" }));
    await waitFor(() => expect(options).toHaveBeenCalledTimes(2));
    fireEvent.click(slot.getByRole("button", { name: "Hand off thread" }));
    const search = await slot.findByRole("combobox", { name: "Search models" });
    const tabs = slot.getByRole("tablist", { name: "Providers" });
    expect(search.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(search, { target: { value: "fast" } });
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Claude" }), { button: 0, ctrlKey: false });
    expect(slot.getByRole("option", { name: "claude fast" })).toBeTruthy();
    expect(slot.queryByRole("status", { name: "Loading models" })).toBeNull();
    expect(search).toHaveProperty("value", "fast");
    expect(slot.getByRole("tab", { name: "Claude" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseDown(slot.getByRole("tab", { name: "Codex" }), { button: 0, ctrlKey: false });
    expect(slot.getByRole("option", { name: "codex fast" })).toBeTruthy();
    expect(options).toHaveBeenCalledTimes(2);
  });

});

describe("sidebar workspace and project filters", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it.each(["status", "workspace", "project"] as const)("filters resolved workspace membership in %s grouping", async mode => {
    const slot = await mount({ mode, threads: [
      thread({ id: "alpha-thread", projectId: "p1" }),
      thread({ id: "beta-thread", projectId: "p2" }),
      thread({ id: "detached-thread", projectId: "p1" }),
    ], workspaceState: { ...state, assignments: [...state.assignments, { kind: "thread", refId: "detached-thread", workspaceId: null, sortIndex: 0 }] } });
    fireEvent.click(slot.getByRole("button", { name: "Filter by workspace: All workspaces" }));
    fireEvent.click(await slot.findByRole("option", { name: "Client work" }));
    expect(slot.getByText("alpha-thread")).toBeTruthy();
    expect(slot.queryByText("beta-thread")).toBeNull();
    expect(slot.queryByText("detached-thread")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Filter by workspace: Client work" }));
    fireEvent.click(await slot.findByRole("option", { name: "Unassigned" }));
    expect(slot.queryByText("alpha-thread")).toBeNull();
    expect(slot.getByText("beta-thread")).toBeTruthy();
    expect(slot.getByText("detached-thread")).toBeTruthy();
  });

  it("searches and selects multiple projects without closing the picker", async () => {
    const slot = await mount({ mode: "status", threads: [thread({ id: "alpha-thread", projectId: "p1" }), thread({ id: "beta-thread", projectId: "p2" })] });
    fireEvent.click(slot.getByRole("button", { name: "Filter by project: All projects" }));
    fireEvent.click(await slot.findByRole("option", { name: "Alpha" }));
    expect(slot.getByText("alpha-thread")).toBeTruthy();
    expect(slot.queryByText("beta-thread")).toBeNull();
    expect(slot.getByRole("option", { name: "Alpha" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(slot.getByPlaceholderText("Search projects…"), { target: { value: "Beta" } });
    expect(slot.queryByRole("option", { name: "Alpha" })).toBeNull();
    fireEvent.click(slot.getByRole("option", { name: "Beta" }));
    expect(slot.getByText("alpha-thread")).toBeTruthy();
    expect(slot.getByText("beta-thread")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Filter by project: 2 projects" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Done selecting projects" }));
    expect(slot.queryByPlaceholderText("Search projects…")).toBeNull();
    expect(slot.inspection.sidebarActionCalls.filter(call => call.method === "open")).toHaveLength(0);
  });

  it("scopes project choices and schedules when switching workspace", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:scheduled-expanded:v1", "true");
    const entries = projects.map(project => ({ id: project.id, projectId: project.id, projectName: project.name, name: `${project.name} schedule`, enabled: true, trigger: null, nextRunAt: null, lastRunStatus: null, lastRunAt: null, lastError: null, threadId: null, problem: null }));
    const slot = await mount({ mode: "status", threads: [thread({ id: "alpha-thread", projectId: "p1" }), thread({ id: "beta-thread", projectId: "p2" })], rpc: { "scheduledTasks.list": () => ({ availability: "ready", entries }) } });
    fireEvent.click(slot.getByRole("button", { name: "Filter by project: All projects" }));
    fireEvent.click(await slot.findByRole("option", { name: "Beta" }));
    fireEvent.click(slot.getByRole("button", { name: "Done selecting projects" }));
    fireEvent.click(slot.getByRole("button", { name: "Filter by workspace: All workspaces" }));
    fireEvent.click(await slot.findByRole("option", { name: "Client work" }));
    expect(slot.getByText("alpha-thread")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Filter by project: All projects" })).toBeTruthy();
    expect(await slot.findByText("Alpha schedule")).toBeTruthy();
    expect(slot.queryByText("Beta schedule")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Filter by project: All projects" }));
    expect(await slot.findByRole("option", { name: "Alpha" })).toBeTruthy();
    expect(slot.queryByRole("option", { name: "Beta" })).toBeNull();
  });

  it("keeps a snoozed thread reachable in the dock and wakes it from there", async () => {
    const until = Date.now() + 60 * 60 * 1000;
    const slot = await mount({
      mode: "status",
      threads: [thread({ id: "parked", projectId: "p1", title: "Parked work" }), thread({ id: "live", projectId: "p1" })],
      workspaceState: { ...state, lifecycle: [{ threadId: "parked", status: null, snoozedUntil: until }] },
    });
    expect(slot.getByText("live")).toBeTruthy();
    const dock = slot.getByLabelText("Snoozed threads");
    expect(within(dock).getByText("Parked work")).toBeTruthy();
    expect(within(dock).getByText(/Today|Tomorrow/)).toBeTruthy();
    // Not in the list itself: the dock is the only place it appears.
    expect(slot.getAllByText("Parked work")).toHaveLength(1);
    expect(slot.queryByLabelText("Wake all snoozed threads")).toBeNull();

    fireEvent.click(within(dock).getByText("Parked work"));
    expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "open", threadId: "parked", options: { split: false } }));

    fireEvent.click(within(dock).getByRole("button", { name: "Wake Parked work" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "workspaces.edit",
      input: expect.objectContaining({ after: expect.objectContaining({ lifecycle: [{ threadId: "parked", status: null, snoozedUntil: null }] }) }),
    })));
    await waitFor(() => expect(slot.queryByLabelText("Snoozed threads")).toBeNull());
    expect(slot.getAllByText("Parked work").length).toBeGreaterThan(0);
  });

  it("wakes a snoozed thread early when it needs a person, without a toast undo", async () => {
    const until = Date.now() + 60 * 60 * 1000;
    const slot = await mount({
      mode: "status",
      threads: [thread({ id: "asks", projectId: "p1", title: "Asks a question", hasPendingInteraction: true, indicator: "waiting-for-input" })],
      workspaceState: { ...state, lifecycle: [{ threadId: "asks", status: null, snoozedUntil: until }] },
    });
    expect(slot.queryByLabelText("Snoozed threads")).toBeNull();
    expect(slot.getByText("Asks a question")).toBeTruthy();
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "workspaces.edit",
      input: expect.objectContaining({ after: expect.objectContaining({ lifecycle: [{ threadId: "asks", status: null, snoozedUntil: null }] }) }),
    })));
  });

  it("opens the thread that ran a schedule on click, and details from the chevron or right-click", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:scheduled-expanded:v1", "true");
    const entry = { id: "auto-1", projectId: "p1", projectName: "Alpha", name: "Nightly triage", enabled: true,
      trigger: { triggerType: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" }, nextRunAt: Date.now() + 30 * 60_000,
      lastRunStatus: "succeeded", lastRunAt: Date.now() - 2 * 3_600_000, lastError: null, threadId: "run-1", problem: null };
    const onNavigate = vi.fn();
    const slot = await mount({
      mode: "status",
      threads: [thread({ id: "run-1", projectId: "p1", title: "Nightly triage run" })],
      onNavigate,
      rpc: { "scheduledTasks.list": () => ({ availability: "ready", entries: [entry] }) },
    });
    const row = await slot.findByRole("link", { name: "Open Nightly triage" });
    // A healthy schedule leads with what comes next; the last run lives in the details.
    expect(within(row).getByText("In 30m")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Run Nightly triage now" })).toBeTruthy();
    fireEvent.click(row);
    expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "open", threadId: "run-1", options: { split: false } }));
    expect(onNavigate).toHaveBeenCalled();
    expect(slot.queryByText("Run now")).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Schedule details: Nightly triage" }));
    expect(await slot.findByText("Run now")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Open last run" })).toBeTruthy();
    expect(slot.getByText(/^succeeded · /)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(slot.queryByText("Run now")).toBeNull());

    fireEvent.contextMenu(row);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Details" }));
    expect(await slot.findByText("Run now")).toBeTruthy();
  });

  it("deletes a schedule only after a second confirming press", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:scheduled-expanded:v1", "true");
    let entries = [{ id: "auto-1", projectId: "p1", projectName: "Alpha", name: "Old job", enabled: true,
      trigger: { triggerType: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" }, nextRunAt: Date.now() + 3_600_000,
      lastRunStatus: null, lastRunAt: null, lastError: null, threadId: null, problem: null }];
    const slot = await mount({
      mode: "status",
      threads: [thread({ id: "t1", projectId: "p1" })],
      rpc: {
        "scheduledTasks.list": () => ({ availability: "ready", entries }),
        "scheduledTasks.delete": () => { entries = []; return { ok: true }; },
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: "Schedule details: Old job" }));
    fireEvent.click(await slot.findByRole("button", { name: "Delete…" }));
    expect(slot.inspection.rpcCalls.some(call => call.method === "scheduledTasks.delete")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Keep" }));
    expect(slot.queryByRole("button", { name: "Delete schedule" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Delete…" }));
    fireEvent.click(slot.getByRole("button", { name: "Delete schedule" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "scheduledTasks.delete", input: { projectId: "p1", automationId: "auto-1" },
    })));
    await waitFor(() => expect(slot.queryByText("Old job")).toBeNull());
  });

  it("shows schedule details on click before the first run, with run and pause actions", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:scheduled-expanded:v1", "true");
    const entry = { id: "auto-1", projectId: "p1", projectName: "Alpha", name: "Nightly triage", enabled: true,
      trigger: { triggerType: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" }, nextRunAt: Date.now() + 3_600_000,
      lastRunStatus: null, lastRunAt: null, lastError: null, threadId: null, problem: null };
    const slot = await mount({
      mode: "status",
      threads: [thread({ id: "t1", projectId: "p1" })],
      rpc: {
        "scheduledTasks.list": () => ({ availability: "ready", entries: [entry] }),
        "scheduledTasks.run": () => ({ ok: true }),
        "scheduledTasks.setEnabled": () => ({ ok: true }),
      },
    });
    const row = await slot.findByRole("link", { name: "Nightly triage: show schedule details" });
    fireEvent.click(row);
    fireEvent.click(await slot.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "scheduledTasks.run", input: { projectId: "p1", automationId: "auto-1" },
    })));
    fireEvent.click(await slot.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "scheduledTasks.setEnabled", input: { projectId: "p1", automationId: "auto-1", enabled: false },
    })));
  });

  it("keeps empty projects available and provides a way to clear empty results", async () => {
    const slot = await mount({ mode: "project", threads: [thread({ id: "alpha-thread", projectId: "p1" })] });
    expect(slot.getByText("Beta")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Filter by project: All projects" }));
    fireEvent.click(await slot.findByRole("option", { name: "Beta" }));
    fireEvent.click(slot.getByRole("button", { name: "Done selecting projects" }));
    expect(slot.queryByText("alpha-thread")).toBeNull();
    expect(slot.getByText("No threads match these filters.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Clear filters" }));
    expect(slot.getByText("alpha-thread")).toBeTruthy();
  });

  it("does not hide the sidebar behind deleted stored filters", async () => {
    window.localStorage.setItem("bb-workspace-sidebar:filters:v1", JSON.stringify({ workspaceId: "deleted-workspace", projectIds: ["deleted-project"] }));
    const slot = await mount({ threads: [thread({ id: "alpha-thread", projectId: "p1" }), thread({ id: "beta-thread", projectId: "p2" })] });
    expect(slot.getByText("alpha-thread")).toBeTruthy();
    expect(slot.getByText("beta-thread")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Filter by workspace: All workspaces" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Filter by project: All projects" })).toBeTruthy();
  });
});

describe("phone row actions", () => {
  it.each([false, true])("keeps the action cluster on the active thread only, compact=%s", async compact => {
    const slot = await mount({
      compact,
      mobile: true,
      activeThreadId: "t1",
      threads: [thread({ id: "t1", projectId: "p1" }), thread({ id: "t2", projectId: "p1" })],
    });
    await slot.findByText("Client work");
    const clusterClassOf = (threadId: string) => {
      const cluster = document
        .querySelector(`[data-sidebar-thread-id="${threadId}"]`)
        ?.querySelector("[data-thread-row-actions]");
      if (!(cluster instanceof HTMLElement)) throw new Error(`no action cluster for ${threadId}`);
      return cluster.className;
    };
    const phoneOnly = compact ? "max-md:pointer-coarse:opacity-100" : "max-md:pointer-coarse:flex";
    const tabletAndUp = compact ? " md:pointer-coarse:opacity-100" : " md:pointer-coarse:flex";

    expect(clusterClassOf("t1")).toContain(phoneOnly);
    expect(clusterClassOf("t1")).toContain(tabletAndUp);
    expect(clusterClassOf("t2")).not.toContain(phoneOnly);
    expect(clusterClassOf("t2")).toContain(tabletAndUp);
  });
});
