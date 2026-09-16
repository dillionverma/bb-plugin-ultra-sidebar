import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { resolveTree, type ProjectGroup, type ResolvedTree } from "./resolve";
import { buildSections, visibleThreadIds } from "./sections";
import { statusBucket } from "./status";
import type { Lifecycle, OrderEntry } from "./types";

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
  order: OrderEntry[] = [],
  showArchived = false,
  lifecycle: Lifecycle[] = [],
  now = 1000,
) {
  return resolveTree({
    status: "ready",
    projects,
    threads,
    order,
    lifecycle,
    showArchived,
    now,
  });
}

function group(tree: ResolvedTree, projectId: string): ProjectGroup {
  return tree.projects.find((candidate) => candidate.projectId === projectId)!;
}

function ids(tree: ResolvedTree, projectId: string): string[] {
  return group(tree, projectId).roots.map((root) => root.thread.id);
}

/** The sections the sidebar would draw, grouped however the caller asks. */
function sectionsOf(
  tree: ResolvedTree,
  groupBy: "project" | "status" = "project",
  projectIds: string[] = [],
) {
  return buildSections({
    tree,
    groupBy,
    projectIds,
    bucketOf: () => statusBucket(null, undefined),
  });
}

describe("resolveTree", () => {
  it("returns an empty tree while the host is still loading", () => {
    const tree = resolveTree({
      status: "loading",
      projects,
      threads: [thread({ id: "t1", projectId: "p1" })],
      order: [],
      lifecycle: [],
      showArchived: false,
    });
    expect(tree.projects).toEqual([]);
    // Orphans must never be derived from a snapshot that is not ready.
    expect(tree.unknownOrder).toEqual([]);
  });

  it("files every thread under its own project, projects A to Z", () => {
    const tree = run([
      thread({ id: "t1", projectId: "p2" }),
      thread({ id: "t2", projectId: "p1" }),
    ]);
    expect(tree.projects.map((entry) => entry.projectId)).toEqual(["p1", "p2"]);
    expect(ids(tree, "p1")).toEqual(["t2"]);
    expect(ids(tree, "p2")).toEqual(["t1"]);
  });

  it("puts projects in the order somebody dragged them into", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [
        { kind: "project", refId: "p2", sortIndex: 0 },
        { kind: "project", refId: "p1", sortIndex: 1 },
      ],
    );
    expect(tree.projects.map((entry) => entry.projectId)).toEqual(["p2", "p1"]);
  });

  it("nests children and counts descendants on the root", () => {
    const tree = run([
      thread({ id: "root", projectId: "p1" }),
      thread({ id: "kid", projectId: "p1", parentThreadId: "root", createdAt: 2 }),
      thread({
        id: "grandkid",
        projectId: "p1",
        parentThreadId: "kid",
        createdAt: 3,
      }),
    ]);
    const root = group(tree, "p1").roots[0]!;
    expect(root.thread.id).toBe("root");
    expect(root.descendantCount).toBe(2);
    expect(root.children[0]!.children[0]!.thread.id).toBe("grandkid");
  });

  it("nests to any depth and rolls flags up from the deepest node", () => {
    const tree = run(
      Array.from({ length: 8 }, (_, i) =>
        thread({
          id: `t${i}`,
          projectId: "p1",
          parentThreadId: i === 0 ? null : `t${i - 1}`,
          createdAt: i + 1,
          // Only the deepest node carries them: the rollup has to survive
          // seven levels, not one.
          isUnread: i === 7,
          hasPendingInteraction: i === 7,
        }),
      ),
    );
    const root = group(tree, "p1").roots[0]!;
    let node = root;
    for (let depth = 0; depth < 8; depth += 1) {
      expect(node.depth).toBe(depth);
      if (depth < 7) node = node.children[0]!;
    }
    expect(node.thread.id).toBe("t7");
    expect(root.descendantCount).toBe(7);
    expect(root.hasUnreadDescendant).toBe(true);
    expect(root.hasPendingDescendant).toBe(true);
  });

  it("keeps every row of a forty-deep chain", () => {
    // Fails before MAX_PARENT_WALK became MAX_DESCENT only past depth 32, so
    // 40 is the shortest chain that proves the ceiling is gone in spirit;
    // this is the regression guard for re-introducing one.
    const depth = 40;
    const tree = run(
      Array.from({ length: depth }, (_, i) =>
        thread({
          id: `t${i}`,
          projectId: "p1",
          parentThreadId: i === 0 ? null : `t${i - 1}`,
          createdAt: i + 1,
        }),
      ),
    );
    const alpha = group(tree, "p1");
    const root = alpha.roots[0]!;
    let node = root;
    while (node.children.length > 0) node = node.children[0]!;
    expect(node.depth).toBe(depth - 1);
    expect(node.thread.id).toBe(`t${depth - 1}`);
    expect(root.descendantCount).toBe(depth - 1);
    expect(alpha.threadCount).toBe(depth);
  });

  it("stops the visible walk at a collapsed node at any depth", () => {
    const tree = run(
      Array.from({ length: 8 }, (_, i) =>
        thread({
          id: `t${i}`,
          projectId: "p1",
          parentThreadId: i === 0 ? null : `t${i - 1}`,
          createdAt: i + 1,
        }),
      ),
    );
    const visible = visibleThreadIds(
      sectionsOf(tree),
      (threadId) => threadId !== "t4",
      () => true,
    );
    expect(visible).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });

  it("promotes a child whose parent is filtered out rather than dropping it", () => {
    const tree = run([
      thread({ id: "root", projectId: "p1", isArchived: true }),
      thread({ id: "kid", projectId: "p1", parentThreadId: "root" }),
    ]);
    expect(ids(tree, "p1")).toEqual(["kid"]);
  });

  it("survives a parent cycle", () => {
    const tree = run([
      thread({ id: "a", projectId: "p1", parentThreadId: "b" }),
      thread({ id: "b", projectId: "p1", parentThreadId: "a" }),
    ]);
    // Neither is a root by the parent rule, so neither renders — but the walk
    // must terminate rather than blowing the stack.
    expect(tree.projects.length).toBeGreaterThan(0);
  });

  it("reports an order row for a vanished thread without rendering it", () => {
    const tree = run(
      [thread({ id: "t1", projectId: "p1" })],
      [{ kind: "thread", refId: "gone", sortIndex: 0 }],
    );
    expect(tree.unknownOrder).toEqual([{ kind: "thread", refId: "gone" }]);
    expect(group(tree, "p1").threadCount).toBe(1);
  });

  it("keeps a thread whose project the host stopped reporting", () => {
    const tree = run([thread({ id: "t1", projectId: "p-gone" })]);
    const orphaned = group(tree, "p-gone");
    expect(orphaned.name).toBe("Unknown project");
    expect(orphaned.roots.map((root) => root.thread.id)).toEqual(["t1"]);
  });

  it("sorts newest created first when nobody has dragged anything", () => {
    const tree = run([
      thread({ id: "old", projectId: "p1", createdAt: 1 }),
      thread({ id: "new", projectId: "p1", createdAt: 9 }),
    ]);
    expect(ids(tree, "p1")).toEqual(["new", "old"]);
    expect(group(tree, "p1").manual).toBe(false);
  });

  it("lifts a pinned thread out of its project and into its own list", () => {
    const tree = run([
      thread({ id: "plain", projectId: "p1", createdAt: 9 }),
      thread({ id: "pinned", projectId: "p1", createdAt: 0, isPinned: true }),
    ]);
    expect(tree.pinned.map((node) => node.thread.id)).toEqual(["pinned"]);
    expect(ids(tree, "p1")).toEqual(["plain"]);
  });

  it("keeps a thread with a manual status in its project", () => {
    // Filing is a grouping concern (see lib/sections); membership is unchanged.
    const tree = run([thread({ id: "t1", projectId: "p1" })], [], false, [
      { threadId: "t1", status: "done", snoozedUntil: null },
    ]);
    expect(group(tree, "p1").threadCount).toBe(1);
  });

  it("parks a snoozed thread in the dock until its time passes", () => {
    const asleep = run(
      [thread({ id: "t1", projectId: "p1" })],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      1000,
    );
    expect(asleep.projects.every((entry) => entry.threadCount === 0)).toBe(true);
    expect(asleep.snoozed).toEqual([
      { thread: expect.objectContaining({ id: "t1" }), until: 5000 },
    ]);
    expect(asleep.wokenEarly).toEqual([]);

    const awake = run(
      [thread({ id: "t1", projectId: "p1" })],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      9000,
    );
    expect(group(awake, "p1").threadCount).toBe(1);
    expect(awake.snoozed).toEqual([]);
  });

  it("wakes a snoozed thread early when it needs a person or is working", () => {
    const cases: Partial<PluginSidebarThread>[] = [
      { hasPendingInteraction: true },
      { indicator: "unread-error" },
      { indicator: "waiting-for-input" },
      { indicator: "runtime" },
      {
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      },
    ];
    for (const overrides of cases) {
      const tree = run(
        [thread({ id: "t1", projectId: "p1", ...overrides })],
        [],
        false,
        [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
        1000,
      );
      expect(group(tree, "p1").threadCount).toBe(1);
      expect(tree.snoozed).toEqual([]);
      expect(tree.wokenEarly).toEqual(["t1"]);
    }
    // Finished quietly: stays asleep. Waking on "unread-success" would undo
    // the snooze the moment an agent finished the very work it was parked for.
    const quiet = run(
      [
        thread({
          id: "t1",
          projectId: "p1",
          indicator: "unread-success",
          isUnread: true,
        }),
      ],
      [],
      false,
      [{ threadId: "t1", status: null, snoozedUntil: 5000 }],
      1000,
    );
    expect(quiet.snoozed).toHaveLength(1);
  });

  it("orders snoozed threads soonest first", () => {
    const tree = run(
      [thread({ id: "a", projectId: "p1" }), thread({ id: "b", projectId: "p2" })],
      [],
      false,
      [
        { threadId: "a", status: null, snoozedUntil: 9000 },
        { threadId: "b", status: null, snoozedUntil: 4000 },
      ],
      1000,
    );
    expect(tree.snoozed.map((entry) => entry.thread.id)).toEqual(["b", "a"]);
  });

  it("honours a hand-picked order, with never-dragged threads above it", () => {
    // A thread nobody has placed is a new one, and a new thread belongs at
    // the top of the list rather than under everything already arranged.
    const tree = run(
      [
        thread({ id: "a", projectId: "p1", createdAt: 1 }),
        thread({ id: "b", projectId: "p1", createdAt: 9 }),
        thread({ id: "never", projectId: "p1", createdAt: 5 }),
      ],
      [
        { kind: "thread", refId: "b", sortIndex: 0 },
        { kind: "thread", refId: "a", sortIndex: 1 },
      ],
    );
    expect(ids(tree, "p1")).toEqual(["never", "b", "a"]);
    expect(group(tree, "p1").manual).toBe(true);
  });
});

describe("buildSections", () => {
  const bucketed = (byId: Record<string, "done" | "backlog">) => (node: {
    thread: { id: string };
  }) => byId[node.thread.id] ?? "in-progress";

  it("leads with Pinned, then a section per project", () => {
    const tree = run([
      thread({ id: "t1", projectId: "p1" }),
      thread({ id: "t2", projectId: "p2", isPinned: true }),
    ]);
    const sections = sectionsOf(tree);
    expect(sections.map((section) => section.id)).toEqual([
      "pinned",
      "project:p1",
      "project:p2",
    ]);
    // A project heading names the project, so its rows must not repeat it;
    // the Pinned list holds threads from anywhere, so its rows must.
    expect(sections[0]!.showProject).toBe(true);
    expect(sections[1]!.showProject).toBe(false);
  });

  it("hides Pinned when nothing is pinned, unless a drag is looking for it", () => {
    const tree = run([thread({ id: "t1", projectId: "p1" })]);
    expect(sectionsOf(tree).map((section) => section.id)).not.toContain("pinned");
    const dragging = buildSections({
      tree,
      groupBy: "project",
      projectIds: [],
      dragging: true,
      bucketOf: () => "in-progress",
    });
    expect(dragging[0]!.id).toBe("pinned");
  });

  it("files finished work under its own heading, below the projects", () => {
    const tree = run([
      thread({ id: "live", projectId: "p1" }),
      thread({ id: "shipped", projectId: "p1" }),
    ]);
    const sections = buildSections({
      tree,
      groupBy: "project",
      projectIds: [],
      bucketOf: bucketed({ shipped: "done" }),
    });
    expect(sections.map((section) => section.id)).toEqual([
      "project:p1",
      "project:p2",
      "status:done",
    ]);
    expect(sections[0]!.roots.map((root) => root.thread.id)).toEqual(["live"]);
    expect(sections[2]!.roots.map((root) => root.thread.id)).toEqual(["shipped"]);
  });

  it("shows all five buckets when grouping by status, empty ones included", () => {
    const tree = run([thread({ id: "t1", projectId: "p1" })]);
    expect(sectionsOf(tree, "status").map((section) => section.name)).toEqual([
      "Done",
      "In review",
      "In progress",
      "Backlog",
      "Canceled",
    ]);
  });

  it("lifts threads waiting on a person, but never above a hand-placed row", () => {
    const tree = run(
      [
        thread({ id: "placed", projectId: "p1", createdAt: 9 }),
        thread({ id: "quiet", projectId: "p2", createdAt: 5 }),
        thread({
          id: "asking",
          projectId: "p2",
          createdAt: 1,
          hasPendingInteraction: true,
        }),
      ],
      [{ kind: "thread", refId: "placed", sortIndex: 0 }],
    );
    const bucket = sectionsOf(tree, "status").find(
      (section) => section.id === "status:in-progress",
    )!;
    expect(bucket.roots.map((root) => root.thread.id)).toEqual([
      "asking",
      "quiet",
      "placed",
    ]);
  });

  it("narrows every grouping to the projects the filter names", () => {
    const tree = run([
      thread({ id: "t1", projectId: "p1" }),
      thread({ id: "t2", projectId: "p2", isPinned: true }),
    ]);
    expect(sectionsOf(tree, "project", ["p1"]).map((section) => section.id)).toEqual([
      "project:p1",
    ]);
  });
});
