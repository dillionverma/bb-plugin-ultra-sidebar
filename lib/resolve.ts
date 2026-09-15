// Turns the host's flat thread/project arrays plus our assignment rows into
// the tree the sidebar renders.
//
// This function must never throw. A throw inside a replaced thread list costs
// the user their entire sidebar (bb re-renders its own list and shows a
// toast), so unknown ids, dangling parents and unrecognized enum values all
// degrade instead of raising.
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type {
  Assignment,
  ItemRef,
  Lifecycle,
  SortMode,
  Workspace,
} from "./types";
import { itemKey } from "./types";

/** Deepest indent the sidebar draws; deeper subagents keep this indent. */
export const MAX_RENDER_DEPTH = 3;

/** Guard for a self-referential or looping parent chain. */
const MAX_PARENT_WALK = 32;

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

export interface ProjectGroup {
  projectId: string;
  name: string;
  isPersonal: boolean;
  /**
   * True when these threads were pulled into this workspace but their project
   * lives elsewhere. Rendered as a muted "from <Project>" heading.
   */
  isForeign: boolean;
  roots: ThreadNode[];
  threadCount: number;
}

export interface Section {
  /** null is the synthetic Unassigned section. */
  workspaceId: string | null;
  name: string;
  sortMode: SortMode;
  groups: ProjectGroup[];
  threadCount: number;
  /**
   * True when the section's rows should render without project headings —
   * set by regrouping, where the section itself is already the grouping and a
   * project heading inside it would be a second one nobody asked for.
   */
  flat?: boolean;
}

/** A root thread parked until a wake time, with the workspace it would sit in. */
export interface SnoozedEntry {
  thread: PluginSidebarThread;
  until: number;
  workspaceId: string | null;
}

export interface ResolvedTree {
  sections: Section[];
  /** Assignments naming a project/thread the host no longer reports. */
  unknownAssignments: ItemRef[];
  /** Roots hidden from the sections until their wake time, soonest first. */
  snoozed: SnoozedEntry[];
  /**
   * Snoozed roots that came back early because they need a person or started
   * working. They are already in the sections; the caller should clear their
   * stored snooze so they do not vanish again the moment they go quiet.
   */
  wokenEarly: string[];
}

export interface ResolveInput {
  status: "loading" | "ready" | "error";
  projects: readonly PluginSidebarProject[];
  threads: readonly PluginSidebarThread[];
  workspaces: readonly Workspace[];
  assignments: readonly Assignment[];
  lifecycle: readonly Lifecycle[];
  showArchived: boolean;
  /** Injected so tests are deterministic rather than clock-dependent. */
  now?: number;
}

const EMPTY_TREE: ResolvedTree = {
  sections: [],
  unknownAssignments: [],
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

  const { projects, threads, workspaces, assignments, showArchived } = input;
  const now = input.now ?? Date.now();

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const workspaceById = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  );

  // Assignment indexes. An assignment pointing at a workspace that no longer
  // exists is treated as absent — cheap insurance against a torn optimistic
  // overlay.
  const projectWorkspace = new Map<string, string | null>();
  const threadWorkspace = new Map<string, string | null>();
  const assignmentOrder = new Map<string, number>();
  const unknownAssignments: ItemRef[] = [];

  for (const assignment of assignments) {
    if (
      assignment.workspaceId !== null &&
      !workspaceById.has(assignment.workspaceId)
    ) {
      continue;
    }
    const known =
      assignment.kind === "project"
        ? projectById.has(assignment.refId)
        : threadById.has(assignment.refId);
    if (!known) {
      unknownAssignments.push({
        kind: assignment.kind,
        refId: assignment.refId,
      });
      continue;
    }
    assignmentOrder.set(
      itemKey(assignment.kind, assignment.refId),
      assignment.sortIndex,
    );
    if (assignment.kind === "project") {
      // A project has no detach state; a null row would be indistinguishable
      // from no row, so ignore it rather than inventing a fourth meaning.
      if (assignment.workspaceId !== null) {
        projectWorkspace.set(assignment.refId, assignment.workspaceId);
      }
    } else {
      threadWorkspace.set(assignment.refId, assignment.workspaceId);
    }
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
  const lifecycleById = new Map(
    input.lifecycle.map((entry) => [entry.threadId, entry]),
  );

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
  // membership one, so it is left to regroup; only snoozing hides a thread.
  const snoozedUntil = new Map<string, number>();
  const wokenEarly: string[] = [];
  for (const entry of lifecycleById.values()) {
    const thread = visibleById.get(entry.threadId);
    if (thread === undefined) continue;
    if (entry.snoozedUntil !== null && entry.snoozedUntil > now) {
      if (wakesEarly(thread)) wokenEarly.push(thread.id);
      else snoozedUntil.set(thread.id, entry.snoozedUntil);
    }
  }

  // Resolve each root's workspace. Children are deliberately not resolved:
  // a subtree always follows its root, so a drag can never tear a subagent
  // away from the thread that spawned it.
  const rootsByWorkspace = new Map<string | null, PluginSidebarThread[]>();
  const snoozed: SnoozedEntry[] = [];
  for (const thread of roots) {
    const workspaceId = resolveThreadWorkspace(
      thread,
      threadWorkspace,
      projectWorkspace,
    );
    // A snoozed thread leaves the sections and waits in the dock instead.
    const until = snoozedUntil.get(thread.id);
    if (until !== undefined) {
      snoozed.push({ thread, until, workspaceId });
      continue;
    }
    const bucket = rootsByWorkspace.get(workspaceId);
    if (bucket === undefined) rootsByWorkspace.set(workspaceId, [thread]);
    else bucket.push(thread);
  }

  const orderedWorkspaces = [...workspaces].sort(
    (a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name),
  );

  const sections: Section[] = [];
  for (const workspace of orderedWorkspaces) {
    sections.push(
      buildSection({
        workspaceId: workspace.id,
        name: workspace.name,
        sortMode: workspace.sortMode,
        rootThreads: rootsByWorkspace.get(workspace.id) ?? [],
        projects,
        projectById,
        projectWorkspace,
        assignmentOrder,
        childrenByParent,
      }),
    );
  }
  sections.push(
    buildSection({
      workspaceId: null,
      name: "Unassigned",
      sortMode: "recent",
      rootThreads: rootsByWorkspace.get(null) ?? [],
      projects,
      projectById,
      projectWorkspace,
      assignmentOrder,
      childrenByParent,
    }),
  );

  snoozed.sort(
    (a, b) => a.until - b.until || a.thread.id.localeCompare(b.thread.id),
  );
  return { sections, unknownAssignments, snoozed, wokenEarly };
}

/**
 * Precedence, and the order matters: an explicit detach stops the walk rather
 * than falling through to the project, which is the whole point of having a
 * third assignment state.
 */
function resolveThreadWorkspace(
  thread: PluginSidebarThread,
  threadWorkspace: ReadonlyMap<string, string | null>,
  projectWorkspace: ReadonlyMap<string, string | null>,
): string | null {
  if (threadWorkspace.has(thread.id)) {
    return threadWorkspace.get(thread.id) ?? null;
  }
  return projectWorkspace.get(thread.projectId) ?? null;
}

interface SectionInput {
  workspaceId: string | null;
  name: string;
  sortMode: SortMode;
  rootThreads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  projectById: ReadonlyMap<string, PluginSidebarProject>;
  projectWorkspace: ReadonlyMap<string, string | null>;
  assignmentOrder: ReadonlyMap<string, number>;
  childrenByParent: ReadonlyMap<string, PluginSidebarThread[]>;
}

function buildSection(input: SectionInput): Section {
  const {
    workspaceId,
    name,
    sortMode,
    rootThreads,
    projects,
    projectById,
    projectWorkspace,
    assignmentOrder,
    childrenByParent,
  } = input;

  const threadsByProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of rootThreads) {
    const bucket = threadsByProject.get(thread.projectId);
    if (bucket === undefined) threadsByProject.set(thread.projectId, [thread]);
    else bucket.push(thread);
  }

  // Projects this workspace owns. For Unassigned that means every project with
  // no assignment row.
  const ownedProjects = projects
    .filter(
      (project) => (projectWorkspace.get(project.id) ?? null) === workspaceId,
    )
    .sort((a, b) => {
      const orderA = assignmentOrder.get(itemKey("project", a.id));
      const orderB = assignmentOrder.get(itemKey("project", b.id));
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });

  const groups: ProjectGroup[] = [];
  const claimed = new Set<string>();

  for (const project of ownedProjects) {
    claimed.add(project.id);
    groups.push(
      buildGroup({
        projectId: project.id,
        name: project.name,
        isPersonal: project.isPersonal,
        isForeign: false,
        threads: threadsByProject.get(project.id) ?? [],
        sortMode,
        assignmentOrder,
        childrenByParent,
      }),
    );
  }

  // Threads pulled in from a project that lives somewhere else. Keeping them
  // grouped under the real project name is what makes an override legible;
  // dumping them loose at the section root is not.
  const foreignProjectIds = [...threadsByProject.keys()]
    .filter((projectId) => !claimed.has(projectId))
    .sort((a, b) => {
      const nameA = projectById.get(a)?.name ?? a;
      const nameB = projectById.get(b)?.name ?? b;
      return nameA.localeCompare(nameB);
    });

  for (const projectId of foreignProjectIds) {
    const project = projectById.get(projectId);
    groups.push(
      buildGroup({
        projectId,
        name: project?.name ?? "Unknown project",
        isPersonal: project?.isPersonal ?? false,
        isForeign: true,
        threads: threadsByProject.get(projectId) ?? [],
        sortMode,
        assignmentOrder,
        childrenByParent,
      }),
    );
  }

  return {
    workspaceId,
    name,
    sortMode,
    groups,
    threadCount: groups.reduce((total, group) => total + group.threadCount, 0),
  };
}

interface GroupInput {
  projectId: string;
  name: string;
  isPersonal: boolean;
  isForeign: boolean;
  threads: readonly PluginSidebarThread[];
  sortMode: SortMode;
  assignmentOrder: ReadonlyMap<string, number>;
  childrenByParent: ReadonlyMap<string, PluginSidebarThread[]>;
}

function buildGroup(input: GroupInput): ProjectGroup {
  const sorted = sortRoots(input.threads, input.sortMode, input.assignmentOrder);
  const roots = sorted.map((thread) =>
    buildNode(thread, 0, input.childrenByParent, new Set([thread.id])),
  );
  return {
    projectId: input.projectId,
    name: input.name,
    isPersonal: input.isPersonal,
    isForeign: input.isForeign,
    roots,
    threadCount: roots.reduce(
      (total, node) => total + 1 + node.descendantCount,
      0,
    ),
  };
}

function sortRoots(
  threads: readonly PluginSidebarThread[],
  sortMode: SortMode,
  assignmentOrder: ReadonlyMap<string, number>,
): PluginSidebarThread[] {
  return [...threads].sort((a, b) => {
    // Pinned threads stay inside their workspace rather than being hoisted to
    // a global section, which would contradict one-workspace-per-thread.
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (sortMode === "manual") {
      const orderA = assignmentOrder.get(itemKey("thread", a.id));
      const orderB = assignmentOrder.get(itemKey("thread", b.id));
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      // Threads the user has never dragged sit after the ones they have.
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
    }
    // A stack: newest thread on top, and a row never moves once it is
    // placed. Sorting by activity was tried and rejected — rows jumped
    // around while agents streamed, which is worse than a stale order.
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

  if (depth < MAX_PARENT_WALK) {
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

/** Flatten a subtree to the ids the sidebar will actually render. */
export function visibleThreadIds(
  sections: readonly Section[],
  isExpanded: (threadId: string) => boolean,
  isSectionOpen: (workspaceId: string | null) => boolean,
): string[] {
  const ids: string[] = [];
  const walk = (node: ThreadNode) => {
    ids.push(node.thread.id);
    if (node.children.length === 0 || !isExpanded(node.thread.id)) return;
    for (const child of node.children) walk(child);
  };
  for (const section of sections) {
    if (!isSectionOpen(section.workspaceId)) continue;
    for (const group of section.groups) {
      for (const root of group.roots) walk(root);
    }
  }
  return ids;
}
