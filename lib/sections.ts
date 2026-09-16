// Lays the resolved tree out as the list of collapsible sections the sidebar
// draws.
//
// The resolver's job is the parent/child forest, pins, snoozes and ordering;
// that work is identical whatever the user is grouping by. So rather than
// teach it two layouts, this takes its output and files the rows. Grouping
// stays a view concern.
import {
  countRows,
  sortRoots,
  type ProjectGroup,
  type ResolvedTree,
  type ThreadNode,
} from "./resolve";
import {
  PARKED_BUCKETS,
  STATUS_BUCKETS,
  STATUS_LABEL,
  statusSectionId,
  type StatusBucket,
} from "./status";

export type GroupBy = "project" | "status";

export const GROUP_BY_OPTIONS: readonly GroupBy[] = ["project", "status"];

export const PINNED_SECTION_ID = "pinned";
export const PROJECT_SECTION_PREFIX = "project:";

export function projectSectionId(projectId: string): string {
  return `${PROJECT_SECTION_PREFIX}${projectId}`;
}

export function projectFromSectionId(id: string): string | null {
  return id.startsWith(PROJECT_SECTION_PREFIX)
    ? id.slice(PROJECT_SECTION_PREFIX.length)
    : null;
}

/** One collapsible heading and the root rows under it. */
export interface Section {
  id: string;
  name: string;
  kind: "pinned" | "project" | "status";
  /** The project this section names, for a project section. */
  projectId: string | null;
  /** True for bb's implicit personal project, which draws its own glyph. */
  isPersonal: boolean;
  /** The bucket this section names, for a status section. */
  bucket: StatusBucket | null;
  roots: ThreadNode[];
  /** Rows, subagents included. */
  threadCount: number;
  /**
   * True when a row must name its own project, because the heading above it
   * does not — every section but a project's.
   */
  showProject: boolean;
  /** Somebody has hand-ordered these rows. */
  manual: boolean;
}

export interface SectionsInput {
  tree: ResolvedTree;
  groupBy: GroupBy;
  /** Empty means every project. */
  projectIds: readonly string[];
  /** Which of the five status buckets a thread belongs in. */
  bucketOf(node: ThreadNode): StatusBucket;
  /** Keep the empty Pinned section on screen as a drop target. */
  dragging?: boolean;
}

/**
 * Pinned first, always. Then the rows however the user asked for them, with
 * Done, Backlog and Canceled trailing in the project view so finished work
 * stops crowding the project it came from.
 */
export function buildSections(input: SectionsInput): Section[] {
  const { tree, groupBy, projectIds, bucketOf, dragging = false } = input;
  const wanted = new Set(projectIds);
  const keep = (node: ThreadNode) =>
    wanted.size === 0 || wanted.has(node.thread.projectId);

  const pinnedRoots = tree.pinned.filter(keep);
  const sections: Section[] = [];
  if (pinnedRoots.length > 0 || dragging) {
    sections.push({
      id: PINNED_SECTION_ID,
      name: "Pinned",
      kind: "pinned",
      projectId: null,
      isPersonal: false,
      bucket: null,
      roots: pinnedRoots,
      threadCount: countRows(pinnedRoots),
      showProject: true,
      manual: tree.pinnedManual,
    });
  }

  const groups =
    wanted.size === 0
      ? tree.projects
      : tree.projects.filter((group) => wanted.has(group.projectId));

  if (groupBy === "status") {
    const byBucket = new Map<StatusBucket, ThreadNode[]>();
    for (const group of groups) {
      for (const node of group.roots) push(byBucket, bucketOf(node), node);
    }
    // All five, in a fixed order, even when empty: the list is the workflow,
    // and a bucket that only appears once something lands in it reads as the
    // sidebar reshuffling itself.
    for (const bucket of STATUS_BUCKETS) {
      sections.push(
        statusSection(
          bucket.key,
          bucket.label,
          byBucket.get(bucket.key) ?? [],
          tree.orderIndex,
        ),
      );
    }
    return sections;
  }

  // Pull the parked threads out of every project first; what is left is the
  // active list, grouped by project.
  const parked = new Map<StatusBucket, ThreadNode[]>();
  for (const group of groups) {
    const active = group.roots.filter((node) => {
      const bucket = bucketOf(node);
      if (!PARKED_BUCKETS.includes(bucket)) return true;
      push(parked, bucket, node);
      return false;
    });
    sections.push(projectSection(group, active));
  }

  for (const bucket of PARKED_BUCKETS) {
    const nodes = parked.get(bucket);
    if (nodes === undefined || nodes.length === 0) continue;
    sections.push(
      statusSection(bucket, STATUS_LABEL[bucket], nodes, tree.orderIndex),
    );
  }
  return sections;
}

function projectSection(group: ProjectGroup, roots: ThreadNode[]): Section {
  return {
    id: projectSectionId(group.projectId),
    name: group.name,
    kind: "project",
    projectId: group.projectId,
    isPersonal: group.isPersonal,
    bucket: null,
    roots,
    threadCount: countRows(roots),
    showProject: false,
    manual: group.manual,
  };
}

/**
 * A status section is one list, not a project's worth of lists laid end to
 * end. The rows arrive grouped by project, each in its own order, so they are
 * re-sorted here against the same global order the resolver used, with
 * anything blocked on a person lifted to the front.
 */
function statusSection(
  bucket: StatusBucket,
  label: string,
  nodes: readonly ThreadNode[],
  orderIndex: ReadonlyMap<string, number>,
): Section {
  const roots = orderBucket(nodes, orderIndex);
  return {
    id: statusSectionId(bucket),
    name: label,
    kind: "status",
    projectId: null,
    isPersonal: false,
    bucket,
    roots,
    threadCount: countRows(roots),
    showProject: true,
    manual: roots.some((node) => orderIndex.has(`thread:${node.thread.id}`)),
  };
}

/**
 * The rows arrive project by project, each project internally ordered, so
 * they are re-sorted against the one global order rather than concatenated.
 *
 * Within the rows nobody has placed by hand, anything waiting on a person —
 * including a question buried in a collapsed subagent — comes first. The lift
 * deliberately stops at the hand-ordered rows: hoisting a row somebody just
 * dragged into place, because its agent asked a question a second later, is
 * indistinguishable from the drag not having worked.
 */
function orderBucket(
  nodes: readonly ThreadNode[],
  orderIndex: ReadonlyMap<string, number>,
): ThreadNode[] {
  const byId = new Map(nodes.map((node) => [node.thread.id, node]));
  const ordered = sortRoots(
    nodes.map((node) => node.thread),
    orderIndex,
  ).map((thread) => byId.get(thread.id)!);
  const placed = (node: ThreadNode) =>
    orderIndex.has(`thread:${node.thread.id}`);
  const loose = ordered.filter((node) => !placed(node));
  const byHand = ordered.filter(placed);
  return [
    ...loose.filter(needsPerson),
    ...loose.filter((node) => !needsPerson(node)),
    ...byHand,
  ];
}

const NEEDS_PERSON_INDICATORS = new Set(["waiting-for-input", "unread-error"]);

function needsPerson(node: ThreadNode): boolean {
  return (
    node.thread.hasPendingInteraction ||
    node.hasPendingDescendant ||
    NEEDS_PERSON_INDICATORS.has(node.thread.indicator)
  );
}

function push<K>(map: Map<K, ThreadNode[]>, key: K, node: ThreadNode): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [node]);
  else bucket.push(node);
}

/** Flatten the sections to the thread ids the sidebar will actually render. */
export function visibleThreadIds(
  sections: readonly Section[],
  isExpanded: (threadId: string) => boolean,
  isSectionOpen: (sectionId: string) => boolean,
): string[] {
  const ids: string[] = [];
  const walk = (node: ThreadNode) => {
    ids.push(node.thread.id);
    if (node.children.length === 0 || !isExpanded(node.thread.id)) return;
    for (const child of node.children) walk(child);
  };
  for (const section of sections) {
    if (!isSectionOpen(section.id)) continue;
    for (const root of section.roots) walk(root);
  }
  return ids;
}
