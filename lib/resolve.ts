// Turns the host's flat thread/project arrays plus our order rows into the
// tree the sidebar renders.
//
// This function must never throw. A throw inside a replaced thread list costs
// the user their entire sidebar (bb re-renders its own list and shows a
// toast), so unknown ids, dangling parents and unrecognized enum values all
// degrade instead of raising.
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { ItemRef, Lifecycle, OrderEntry } from "./types";
import { itemKey } from "./types";

/**
 * A stack belt for buildNode, not a nesting limit: nesting is unlimited.
 *
 * Cycles are handled by the `seen` set, not by this number: every thread has
 * exactly one parentThreadId, so it lives in exactly one childrenByParent
 * bucket, the visible graph is a forest plus disjoint unreachable cycles, and
 * a child is added to `seen` before it is recursed into. This bound only keeps
 * a pathological chain from exhausting the JS stack, which would throw, and
 * this file must never throw.
 */
const MAX_DESCENT = 1000;

export interface ThreadNode {
  thread: PluginSidebarThread;
  depth: number;
  children: ThreadNode[];
  /** Descendant count, all levels. Shown on a collapsed parent. */
  descendantCount: number;
  /** True when any descendant is unread — surfaced while collapsed. */
  hasUnreadDescendant: boolean;
  /** True when any descendant is waiting on the user. */
  hasPendingDescendant: boolean;
}

/** Every root thread of one project, in the order the sidebar shows them. */
export interface ProjectGroup {
  projectId: string;
  name: string;
  isPersonal: boolean;
  roots: ThreadNode[];
  threadCount: number;
  /** True when somebody has hand-ordered these rows. */
  manual: boolean;
}

/** A root thread parked until a wake time. */
export interface SnoozedEntry {
  thread: PluginSidebarThread;
  until: number;
}

export interface ResolvedTree {
  /** Pinned roots: they lead the whole list, whatever their project. */
  pinned: ThreadNode[];
  /** True when somebody has hand-ordered the pinned rows. */
  pinnedManual: boolean;
  /** One per project the host reports, in project order. */
  projects: ProjectGroup[];
  /**
   * The hand-picked position of every item that has one, keyed by itemKey.
   * Exposed so a view that re-buckets these rows — the status grouping — can
   * sort them against the same order rather than inventing a second one.
   */
  orderIndex: ReadonlyMap<string, number>;
  /** Order rows naming a project/thread the host no longer reports. */
  unknownOrder: ItemRef[];
  /** Roots hidden from the list until their wake time, soonest first. */
  snoozed: SnoozedEntry[];
  /**
   * Snoozed roots that came back early because they need a person or started
   * working. They are already in the list; the caller should clear their
   * stored snooze so they do not vanish again the moment they go quiet.
   */
  wokenEarly: string[];
}

export interface ResolveInput {
  status: "loading" | "ready" | "error";
  projects: readonly PluginSidebarProject[];
  threads: readonly PluginSidebarThread[];
  order: readonly OrderEntry[];
  lifecycle: readonly Lifecycle[];
  showArchived: boolean;
  /** Injected so tests are deterministic rather than clock-dependent. */
  now?: number;
}

const EMPTY_TREE: ResolvedTree = {
  pinned: [],
  pinnedManual: false,
  projects: [],
  orderIndex: new Map(),
  unknownOrder: [],
  snoozed: [],
  wokenEarly: [],
};

const ATTENTION_INDICATORS = new Set(["waiting-for-input", "unread-error"]);
const LIVE_INDICATORS = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "plan-mode",
  "goal",
]);

/**
 * Snooze hides a thread that is waiting on nobody. The moment it asks for a
 * person, fails, or starts working again it must come back: hiding live work
 * or a raised hand is the one failure this feature cannot afford.
 */
export function wakesEarly(thread: PluginSidebarThread): boolean {
  if (thread.hasPendingInteraction) return true;
  if (ATTENTION_INDICATORS.has(thread.indicator)) return true;
  if (LIVE_INDICATORS.has(thread.indicator)) return true;
  const activity = thread.activity;
  return (
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0
  );
}

export function resolveTree(input: ResolveInput): ResolvedTree {
  // Never derive anything — least of all orphan candidates — from a snapshot
  // the host has not finished loading.
  if (input.status !== "ready") return EMPTY_TREE;

  const { projects, threads, order, showArchived } = input;
  const now = input.now ?? Date.now();

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));

  const orderIndex = new Map<string, number>();
  const unknownOrder: ItemRef[] = [];
  for (const entry of order) {
    const known =
      entry.kind === "project"
        ? projectById.has(entry.refId)
        : threadById.has(entry.refId);
    if (!known) {
      unknownOrder.push({ kind: entry.kind, refId: entry.refId });
      continue;
    }
    orderIndex.set(itemKey(entry.kind, entry.refId), entry.sortIndex);
  }

  // Visible set first: archived threads must not appear in the parent/child
  // forest either, or a live child would hang off an invisible parent.
  const visible = showArchived
    ? threads
    : threads.filter((thread) => !thread.isArchived);
  const visibleById = new Map(visible.map((thread) => [thread.id, thread]));

  // A thread is a root when it has no parent, or when its parent is not
  // visible (deleted, archived, filtered). Promoting an orphaned child is the
  // difference between "the subagent moved up a level" and "the subagent
  // vanished".
  const roots: PluginSidebarThread[] = [];
  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of visible) {
    const parentId = thread.parentThreadId;
    if (parentId === null || !visibleById.has(parentId)) {
      roots.push(thread);
      continue;
    }
    const siblings = childrenByParent.get(parentId);
    if (siblings === undefined) childrenByParent.set(parentId, [thread]);
    else siblings.push(thread);
  }

  // A manual status (Backlog, Done, Canceled) is a grouping concern, not a
  // membership one, so it is left to the section builder; only snoozing hides
  // a thread.
  const snoozedUntil = new Map<string, number>();
  const wokenEarly: string[] = [];
  for (const entry of input.lifecycle) {
    const thread = visibleById.get(entry.threadId);
    if (thread === undefined) continue;
    if (entry.snoozedUntil !== null && entry.snoozedUntil > now) {
      if (wakesEarly(thread)) wokenEarly.push(thread.id);
      else snoozedUntil.set(thread.id, entry.snoozedUntil);
    }
  }

  // Pinned roots leave their project and lead the whole list; that is what
  // "pin to the top" means, and a pin that only reached the top of one
  // project group would not be worth the gesture.
  const pinnedRoots: PluginSidebarThread[] = [];
  const rootsByProject = new Map<string, PluginSidebarThread[]>();
  const snoozed: SnoozedEntry[] = [];
  for (const thread of roots) {
    const until = snoozedUntil.get(thread.id);
    // A snoozed thread leaves the list and waits in the dock instead.
    if (until !== undefined) {
      snoozed.push({ thread, until });
      continue;
    }
    if (thread.isPinned) {
      pinnedRoots.push(thread);
      continue;
    }
    const bucket = rootsByProject.get(thread.projectId);
    if (bucket === undefined) rootsByProject.set(thread.projectId, [thread]);
    else bucket.push(thread);
  }

  // Projects in the user's order, then alphabetical for the ones never moved.
  const orderedProjects = [...projects].sort((a, b) => {
    const indexA = orderIndex.get(itemKey("project", a.id));
    const indexB = orderIndex.get(itemKey("project", b.id));
    if (indexA !== undefined && indexB !== undefined) return indexA - indexB;
    if (indexA !== undefined) return -1;
    if (indexB !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });

  const projectGroups: ProjectGroup[] = orderedProjects.map((project) => {
    const threadsHere = rootsByProject.get(project.id) ?? [];
    const sorted = sortRoots(threadsHere, orderIndex);
    const groupRoots = sorted.map((thread) =>
      buildNode(thread, 0, childrenByParent, new Set([thread.id])),
    );
    return {
      projectId: project.id,
      name: project.name,
      isPersonal: project.isPersonal,
      roots: groupRoots,
      threadCount: countRows(groupRoots),
      manual: threadsHere.some((thread) =>
        orderIndex.has(itemKey("thread", thread.id)),
      ),
    };
  });

  // Threads whose project the host stopped reporting still have to appear
  // somewhere, or they would silently vanish from the sidebar.
  for (const [projectId, threadsHere] of rootsByProject) {
    if (projectById.has(projectId)) continue;
    const sorted = sortRoots(threadsHere, orderIndex);
    const groupRoots = sorted.map((thread) =>
      buildNode(thread, 0, childrenByParent, new Set([thread.id])),
    );
    projectGroups.push({
      projectId,
      name: "Unknown project",
      isPersonal: false,
      roots: groupRoots,
      threadCount: countRows(groupRoots),
      manual: false,
    });
  }

  const pinned = sortRoots(pinnedRoots, orderIndex).map((thread) =>
    buildNode(thread, 0, childrenByParent, new Set([thread.id])),
  );

  snoozed.sort(
    (a, b) => a.until - b.until || a.thread.id.localeCompare(b.thread.id),
  );
  return {
    pinned,
    pinnedManual: pinnedRoots.some((thread) =>
      orderIndex.has(itemKey("thread", thread.id)),
    ),
    projects: projectGroups,
    orderIndex,
    unknownOrder,
    snoozed,
    wokenEarly,
  };
}

export function countRows(nodes: readonly ThreadNode[]): number {
  return nodes.reduce((total, node) => total + 1 + node.descendantCount, 0);
}

/**
 * Newest first, except where somebody has said otherwise.
 *
 * A thread with no stored position has never been dragged, and sorts above
 * the ones that have: that is what keeps a brand new thread at the top of a
 * list the user has hand-ordered, instead of burying it underneath. Sorting
 * by activity was tried and rejected — rows jumped around while agents
 * streamed, which is worse than a stale order.
 */
export function sortRoots(
  threads: readonly PluginSidebarThread[],
  orderIndex: ReadonlyMap<string, number>,
): PluginSidebarThread[] {
  return [...threads].sort((a, b) => {
    const indexA = orderIndex.get(itemKey("thread", a.id));
    const indexB = orderIndex.get(itemKey("thread", b.id));
    if (indexA !== undefined && indexB !== undefined) return indexA - indexB;
    if (indexA !== undefined) return 1;
    if (indexB !== undefined) return -1;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id.localeCompare(b.id);
  });
}

function buildNode(
  thread: PluginSidebarThread,
  depth: number,
  childrenByParent: ReadonlyMap<string, PluginSidebarThread[]>,
  seen: Set<string>,
): ThreadNode {
  const rawChildren = childrenByParent.get(thread.id) ?? [];
  const children: ThreadNode[] = [];
  let descendantCount = 0;
  let hasUnreadDescendant = false;
  let hasPendingDescendant = false;

  if (depth < MAX_DESCENT) {
    // Subagents read best in spawn order, unlike roots which are recency-first.
    const ordered = [...rawChildren].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    for (const child of ordered) {
      if (seen.has(child.id)) continue; // cycle guard
      seen.add(child.id);
      const node = buildNode(child, depth + 1, childrenByParent, seen);
      children.push(node);
      descendantCount += 1 + node.descendantCount;
      hasUnreadDescendant =
        hasUnreadDescendant || child.isUnread || node.hasUnreadDescendant;
      hasPendingDescendant =
        hasPendingDescendant ||
        child.hasPendingInteraction ||
        node.hasPendingDescendant;
    }
  }

  return {
    thread,
    depth,
    children,
    descendantCount,
    hasUnreadDescendant,
    hasPendingDescendant,
  };
}

/**
 * How many rows this node will actually render: itself, plus every descendant
 * reachable through expanded chevrons. The windowed list treats a whole root
 * subtree as one item, so this is the only honest height estimate for it.
 */
export function expandedRowCount(
  node: ThreadNode,
  isExpanded: (threadId: string) => boolean,
): number {
  if (node.children.length === 0 || !isExpanded(node.thread.id)) return 1;
  let total = 1;
  for (const child of node.children) {
    total += expandedRowCount(child, isExpanded);
  }
  return total;
}
