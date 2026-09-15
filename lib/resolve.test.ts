import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { resolveTree } from "./resolve";
import type { Assignment, Lifecycle, Workspace } from "./types";

const workspaces: Workspace[] = [
  { id: "ws1", name: "One", sortIndex: 0, sortMode: "recent", createdAt: 1 },
  { id: "ws2", name: "Two", sortIndex: 1, sortMode: "recent", createdAt: 1 },
];

const projects = [
  { id: "p1", name: "Alpha", isPersonal: false },
  { id: "p2", name: "Beta", isPersonal: false },
];

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

function run(
  threads: PluginSidebarThread[],
  assignments: Assignment[],
  showArchived = false,
  lifecycle: Lifecycle[] = [],
  now = 1000,
) {
  return resolveTree({
    status: "ready",
    projects,
    threads,
    workspaces,
    assignments,
    lifecycle,
    showArchived,
    now,
  });
}

function section(tree: ReturnType<typeof run>, workspaceId: string | null) {
  return tree.sections.find((candidate) => candidate.workspaceId === workspaceId)!;
}

describe("resolveTree", () => {
  it("returns an empty tree while the host is still loading", () => {
    const tree = resolveTree({
      status: "loading",
      projects,
      threads: [thread({ id: "t1", projectId: "p1" })],
      workspaces,
      assignments: [],
      lifecycle: [],
      showArchived: false,
    });
    expect(tree.sections).toEqual([]);
    // Orphans must never be derived from a snapshot that is not ready.
    expect(tree.unknownAssignments).toEqual([]);
  });

  it("lets a thread inherit its project's workspace", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [{ kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 }],
    );
    expect(section(tree, "ws1").groups[0]!.roots[0]!.thread.id).toBe("t1");
    expect(section(tree, null).groups.map((g) => g.projectId)).toEqual(["p2"]);
  });

  it("puts an overridden thread in the other workspace as a foreign group", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" }), thread({ id: "t2", projectId: "p1" })],
      [
        { kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 },
        { kind: "thread", refId: "t2", workspaceId: "ws2", sortIndex: 1 },
      ],
    );
    expect(section(tree, "ws1").groups[0]!.roots.map((r) => r.thread.id)).toEqual([
      "t1",
    ]);
    const foreign = section(tree, "ws2").groups[0]!;
    expect(foreign.isForeign).toBe(true);
    expect(foreign.name).toBe("Alpha");
    expect(foreign.roots[0]!.thread.id).toBe("t2");
  });

  // The whole reason assignment has three states rather than two.
  it("stops at an explicit detach instead of inheriting the project", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [
        { kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 },
        { kind: "thread", refId: "t1", workspaceId: null, sortIndex: 1 },
      ],
    );
    expect(section(tree, "ws1").threadCount).toBe(0);
    const unassigned = section(tree, null);
    expect(unassigned.groups.some((g) => g.roots.some((r) => r.thread.id === "t1"))).toBe(
      true,
    );
  });

  it("nests children and counts descendants on the root", () => {
    const tree = run(
      [
        thread({ id: "root", projectId: "p1" }),
        thread({ id: "kid", projectId: "p1", parentThreadId: "root", createdAt: 2 }),
        thread({ id: "grandkid", projectId: "p1", parentThreadId: "kid", createdAt: 3 }),
      ],
      [],
    );
    const root = section(tree, null).groups[0]!.roots[0]!;
    expect(root.thread.id).toBe("root");
    expect(root.descendantCount).toBe(2);
    expect(root.children[0]!.children[0]!.thread.id).toBe("grandkid");
  });

  it("promotes a child whose parent is filtered out rather than dropping it", () => {
    const tree = run(
      [
        thread({ id: "root", projectId: "p1", isArchived: true }),
        thread({ id: "kid", projectId: "p1", parentThreadId: "root" }),
      ],
      [],
    );
    const roots = section(tree, null).groups[0]!.roots;
    expect(roots.map((r) => r.thread.id)).toEqual(["kid"]);
  });

  it("survives a parent cycle", () => {
    const tree = run(
      [
        thread({ id: "a", projectId: "p1", parentThreadId: "b" }),
        thread({ id: "b", projectId: "p1", parentThreadId: "a" }),
      ],
      [],
    );
    // Neither is a root by the parent rule, so neither renders — but the walk
    // must terminate rather than blowing the stack.
    expect(tree.sections.length).toBeGreaterThan(0);
  });

  it("reports an assignment for a vanished thread without rendering it", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [{ kind: "thread", refId: "gone", workspaceId: "ws1", sortIndex: 0 }],
    );
    expect(tree.unknownAssignments).toEqual([{ kind: "thread", refId: "gone" }]);
    expect(section(tree, "ws1").threadCount).toBe(0);
  });

  it("ignores an assignment pointing at a deleted workspace", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [{ kind: "project", refId: "p1", workspaceId: "ws-gone", sortIndex: 0 }],
    );
    expect(section(tree, null).groups.map((g) => g.projectId)).toContain("p1");
  });

  it("sorts pinned first, then newest created, under the default mode", () => {
    const tree = run(
      [
        thread({ id: "old", projectId: "p1", createdAt: 1 }),
        thread({ id: "new", projectId: "p1", createdAt: 9 }),
        thread({ id: "pinned", projectId: "p1", createdAt: 0, isPinned: true }),
      ],
      [],
    );
    expect(
      section(tree, null).groups[0]!.roots.map((r) => r.thread.id),
    ).toEqual(["pinned", "new", "old"]);
  });

  it("keeps a thread with a manual status in its workspace", () => {
    // Filing is a grouping concern (see regroup); membership is unchanged.
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [],
      false,
      [{ threadId: "t1", status: "done", snoozedUntil: null }],
    );
    expect(section(tree, null).threadCount).toBe(1);
  });

  it("parks a snoozed thread in the dock until its time passes", () => {
    const asleep = run(
      [thread({ id: "t1", projectId: "p1" })],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      1000,
    );
    expect(asleep.sections.every((s) => s.threadCount === 0)).toBe(true);
    expect(asleep.snoozed).toEqual([
      { thread: expect.objectContaining({ id: "t1" }), until: 5000, workspaceId: null },
    ]);
    expect(asleep.wokenEarly).toEqual([]);

    const awake = run(
      [thread({ id: "t1", projectId: "p1" })],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      9000,
    );
    expect(section(awake, null).threadCount).toBe(1);
    expect(awake.snoozed).toEqual([]);
  });

  it("wakes a snoozed thread early when it needs a person or is working", () => {
    const cases: Partial<PluginSidebarThread>[] = [
      { hasPendingInteraction: true },
      { indicator: "unread-error" },
      { indicator: "waiting-for-input" },
      { indicator: "runtime" },
      { activity: { workflows: 1, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 } },
    ];
    for (const overrides of cases) {
      const tree = run(
        [thread({ id: "t1", projectId: "p1", ...overrides })],
        [],
        false,
        [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
        1000,
      );
      expect(section(tree, null).threadCount).toBe(1);
      expect(tree.snoozed).toEqual([]);
      expect(tree.wokenEarly).toEqual(["t1"]);
    }
    // Finished quietly: stays asleep. Waking on "unread-success" would undo
    // the snooze the moment an agent finished the very work it was parked for.
    const quiet = run(
      [thread({ id: "t1", projectId: "p1", indicator: "unread-success", isUnread: true })],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      1000,
    );
    expect(quiet.snoozed).toHaveLength(1);
  });

  it("orders snoozed threads soonest first and keeps their workspace", () => {
    const tree = run(
      [thread({ id: "a", projectId: "p1" }), thread({ id: "b", projectId: "p2" })],
      [{ kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 }],
      false,
      [
        { threadId: "a", status: null, snoozedUntil: 9000 },
        { threadId: "b", status: null, snoozedUntil: 4000 },
      ],
      1000,
    );
    expect(tree.snoozed.map((entry) => [entry.thread.id, entry.workspaceId])).toEqual([
      ["b", null],
      ["a", "ws1"],
    ]);
  });

  it("honours manual order, with never-dragged threads after the ordered ones", () => {
    const manual: Workspace[] = [
      { id: "ws1", name: "One", sortIndex: 0, sortMode: "manual", createdAt: 1 },
    ];
    const tree = resolveTree({
      status: "ready",
      projects,
      threads: [
        thread({ id: "a", projectId: "p1", createdAt: 1 }),
        thread({ id: "b", projectId: "p1", createdAt: 9 }),
        thread({ id: "never", projectId: "p1", createdAt: 5 }),
      ],
      lifecycle: [],
      workspaces: manual,
      assignments: [
        { kind: "project", refId: "p1", workspaceId: "ws1", sortIndex: 0 },
        { kind: "thread", refId: "b", workspaceId: "ws1", sortIndex: 1 },
        { kind: "thread", refId: "a", workspaceId: "ws1", sortIndex: 2 },
      ],
      showArchived: false,
    });
    expect(
      tree.sections[0]!.groups[0]!.roots.map((r) => r.thread.id),
    ).toEqual(["b", "a", "never"]);
  });
});
