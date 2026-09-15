// Re-buckets the resolved tree under a different grouping.
//
// The resolver's job is workspace membership and the parent/child forest; that
// work is identical whatever the user is grouping by. So rather than teach it
// three layouts, this takes its output and re-files the rows. Grouping stays a
// view concern, and the membership rules stay in one place.
import type { Section, ThreadNode } from "./resolve";
import {
  PARKED_BUCKETS,
  STATUS_BUCKETS,
  STATUS_LABEL,
  STATUS_SECTION_PREFIX,
  statusSectionId,
  type StatusBucket,
} from "./status";

export type GroupBy = "status" | "workspace" | "project";

export const PROJECT_SECTION_PREFIX = "project:";

export function projectSectionId(projectId: string): string {
  return `${PROJECT_SECTION_PREFIX}${projectId}`;
}

/**
 * True for a section this module invented — a status bucket or a project
 * group — as opposed to a workspace the user created. A synthetic section has
 * no stored order, so a drop into one can only change what it is keyed on.
 */
export function isSyntheticSectionId(id: string | null): boolean {
  return (
    id !== null &&
    (id.startsWith(STATUS_SECTION_PREFIX) || id.startsWith(PROJECT_SECTION_PREFIX))
  );
}

export interface RegroupInput {
  sections: readonly Section[];
  groupBy: GroupBy;
  /** Only one project's threads, or null for all of them. */
  projectFilter: string | null;
  /** Which of the five status buckets a thread belongs in. */
  bucketOf(node: ThreadNode): StatusBucket;
}

/**
 * Sections produced here are `flat`: the rows carry their own project and
 * status, so a project heading inside a status bucket would be a second
 * grouping the user did not ask for.
 *
 * Whatever the grouping, a thread filed as Done, Backlog or Canceled leaves
 * the active list: in the status view that is just its bucket, and in the
 * workspace and project views those three buckets trail the real groups, so
 * finished work stops crowding the workspace it came from.
 */
export function regroup(input: RegroupInput): Section[] {
  const { sections, groupBy, projectFilter, bucketOf } = input;

  const filtered =
    projectFilter === null
      ? sections
      : sections.map((section) => filterSection(section, projectFilter));

  if (groupBy === "status") {
    const byBucket = new Map<StatusBucket, ThreadNode[]>();
    for (const section of filtered) {
      for (const group of section.groups) {
        for (const node of group.roots) push(byBucket, bucketOf(node), node);
      }
    }
    // All five, in a fixed order, even when empty: the list is the workflow,
    // and a bucket that only appears once something lands in it reads as the
    // sidebar reshuffling itself.
    return STATUS_BUCKETS.map((bucket) =>
      flatSection(
        statusSectionId(bucket.key),
        bucket.label,
        byRecency(byBucket.get(bucket.key) ?? []),
      ),
    );
  }

  // Pull the parked threads out of every section first; what is left is the
  // active list, grouped however the user asked.
  const parked = new Map<StatusBucket, ThreadNode[]>();
  const active = filtered.map((section) => {
    const groups = section.groups.map((group) => {
      const roots = group.roots.filter((node) => {
        const bucket = bucketOf(node);
        if (!PARKED_BUCKETS.includes(bucket)) return true;
        push(parked, bucket, node);
        return false;
      });
      return {
        ...group,
        roots,
        threadCount: roots.reduce(
          (total, node) => total + 1 + node.descendantCount,
          0,
        ),
      };
    });
    return {
      ...section,
      groups,
      threadCount: groups.reduce((total, group) => total + group.threadCount, 0),
    };
  });

  const trailing = PARKED_BUCKETS.flatMap((bucket) => {
    const nodes = parked.get(bucket);
    if (nodes === undefined || nodes.length === 0) return [];
    return [
      flatSection(statusSectionId(bucket), STATUS_LABEL[bucket], byRecency(nodes)),
    ];
  });

  if (groupBy === "workspace") {
    // Drop sections the filter emptied, but keep an empty workspace the user
    // has actually created — it is a drop target, not noise.
    const kept =
      projectFilter === null
        ? active
        : active.filter((section) => section.threadCount > 0);
    return [...kept, ...trailing];
  }

  const byProject = new Map<
    string,
    { projectName: string; nodes: ThreadNode[] }
  >();
  for (const section of active) {
    for (const group of section.groups) {
      const entry = byProject.get(group.projectId);
      if (entry === undefined) {
        byProject.set(group.projectId, {
          projectName: group.name,
          nodes: [...group.roots],
        });
      } else {
        entry.nodes.push(...group.roots);
      }
    }
  }
  const byProjectSections = [...byProject.entries()]
    .filter(([, entry]) => entry.nodes.length > 0)
    .sort((a, b) => a[1].projectName.localeCompare(b[1].projectName))
    .map(([projectId, entry]) =>
      flatSection(projectSectionId(projectId), entry.projectName, entry.nodes),
    );
  return [...byProjectSections, ...trailing];
}

/**
 * A status section is one list, not a workspace's worth of lists laid end to
 * end. The rows arrive grouped by workspace and project, each in its own
 * order, so they are re-sorted here: pinned first, then anything blocked on
 * the person (a question, an approval, a failure — including one buried in a
 * collapsed subagent), then newest created first.
 */
function byRecency(nodes: readonly ThreadNode[]): ThreadNode[] {
  return [...nodes].sort((a, b) => {
    if (a.thread.isPinned !== b.thread.isPinned) return a.thread.isPinned ? -1 : 1;
    const needA = needsPerson(a);
    const needB = needsPerson(b);
    if (needA !== needB) return needA ? -1 : 1;
    if (a.thread.createdAt !== b.thread.createdAt) {
      return b.thread.createdAt - a.thread.createdAt;
    }
    return a.thread.id.localeCompare(b.thread.id);
  });
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

function filterSection(section: Section, projectId: string): Section {
  const groups = section.groups.filter(
    (group) => group.projectId === projectId,
  );
  return {
    ...section,
    groups,
    threadCount: groups.reduce((total, group) => total + group.threadCount, 0),
  };
}

function flatSection(id: string, name: string, roots: ThreadNode[]): Section {
  const count = roots.reduce(
    (total, node) => total + 1 + node.descendantCount,
    0,
  );
  return {
    workspaceId: id,
    name,
    sortMode: "recent",
    flat: true,
    groups:
      roots.length === 0
        ? []
        : [
            {
              projectId: id,
              name,
              isPersonal: false,
              isForeign: false,
              roots,
              threadCount: count,
            },
          ],
    threadCount: count,
  };
}
