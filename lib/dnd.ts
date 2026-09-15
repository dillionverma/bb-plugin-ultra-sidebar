// What a drop means, free of DOM and React.
//
// dnd-kit owns the gesture: the sensors, the row that follows the pointer,
// autoscroll, the rows sliding aside inside a list. What it cannot know is the
// sidebar's rules — a thread can be filed into a status bucket but never into
// another project, a workspace only orders against workspaces — so every
// draggable and droppable carries a DropZone, and resolveDrop turns the pair
// under the pointer into an action, or null for a hover that means nothing.
import type { ItemKind } from "./types";
import { UNASSIGNED_ID } from "./types";
import { isSyntheticSectionId } from "./regroup";
import { bucketFromSectionId, type StatusBucket } from "./status";

/** Minimum vertical travel before a press becomes a reorder. */
export const ENGAGE_PX = 6;

/**
 * Sideways travel that hands the gesture to bb instead. The host's
 * drag-to-split engages once the pointer leaves the sidebar to the right, so
 * a press that heads that way before it has moved ENGAGE_PX down is not ours.
 */
export const SPLIT_TOLERANCE_PX = 24;

/** Hold before a touch becomes a drag, so a swipe still scrolls the list. */
export const TOUCH_HOLD_MS = 250;

/** Hover-to-expand delay over a collapsed section during a drag. */
export const SPRING_LOAD_MS = 600;

export type DragKind = ItemKind | "workspace";

/** A row or section: what can sit under the pointer, or be picked up. */
export interface DropZone {
  kind: DragKind;
  /** The row's id; for a workspace zone the section id, null for Unassigned. */
  refId: string | null;
  /** The section the zone belongs to; null for Unassigned. */
  workspaceId: string | null;
}

/** The zone that was picked up. Unassigned has no id, so it never is one. */
export type DragSource = DropZone & { refId: string };

/** What every dnd-kit node carries in `data`. */
export interface DndData {
  zone: DropZone;
  draggable: boolean;
}

/** The zone as a drag source, or null when it cannot be picked up. */
export function sourceOf(data: DndData | null): DragSource | null {
  if (data === null || !data.draggable || data.zone.refId === null) return null;
  return data.zone as DragSource;
}

export type DropSide = "before" | "after";

export type DropResolution =
  /** Same kind, same section: the list animation already shows the result. */
  | { action: "reorder"; workspaceId: string | null; anchorRefId: string }
  /** Into another section, at a row or at the end. */
  | { action: "move"; workspaceId: string | null; anchorRefId: string | null }
  /** Filed into a status bucket. */
  | { action: "status"; bucket: StatusBucket };

/** dnd-kit ids must be unique across every list in the sidebar. */
export function sortableId(zone: DropZone): string {
  switch (zone.kind) {
    case "thread":
      return `thread:${zone.refId ?? ""}`;
    // A project can show in two sections at once (owned in one, borrowed
    // into another), so the section is part of the id.
    case "project":
      return `project:${zone.workspaceId ?? UNASSIGNED_ID}:${zone.refId ?? ""}`;
    case "workspace":
      return `workspace:${zone.refId ?? UNASSIGNED_ID}`;
  }
}

/** The key a section's drop ring compares against. */
export function sectionKey(workspaceId: string | null): string {
  return `section:${workspaceId ?? UNASSIGNED_ID}`;
}

/**
 * Decide what dropping `source` on `zone` would do, or null when nothing.
 *
 * Threads reorder against threads and land in whatever section the zone
 * belongs to; projects likewise; a workspace only reorders against another
 * workspace. A status bucket has no order of its own, so the whole bucket is
 * the target and only a thread can be filed there. A project group (the
 * project view) accepts nothing: a drag cannot change which project a thread
 * belongs to, and pretending otherwise would be a lie.
 */
export function resolveDrop(
  source: DragSource,
  zone: DropZone,
): DropResolution | null {
  if (source.kind === "workspace") {
    if (zone.kind !== "workspace" || zone.refId === null) return null;
    if (isSyntheticSectionId(zone.refId) || zone.refId === source.refId) {
      return null;
    }
    return { action: "reorder", workspaceId: null, anchorRefId: zone.refId };
  }

  if (isSyntheticSectionId(zone.workspaceId)) {
    if (source.kind !== "thread") return null;
    if (zone.workspaceId === source.workspaceId) return null;
    const bucket = bucketFromSectionId(zone.workspaceId);
    return bucket === null ? null : { action: "status", bucket };
  }

  const sameSection = zone.workspaceId === source.workspaceId;

  if (zone.kind === source.kind && zone.refId !== null) {
    if (zone.refId === source.refId) return null;
    return sameSection
      ? { action: "reorder", workspaceId: zone.workspaceId, anchorRefId: zone.refId }
      : { action: "move", workspaceId: zone.workspaceId, anchorRefId: zone.refId };
  }

  // A header, an empty section, or a row of the other kind: into that
  // section, at the end. Already there means nothing to do.
  if (sameSection) return null;
  return { action: "move", workspaceId: zone.workspaceId, anchorRefId: null };
}

/**
 * The decorations a hover lights up. A reorder needs none — the rows sliding
 * aside already say where the drop lands — while a move or a filing rings the
 * target section, with a line at the row when there is one.
 */
export function hoverKeys(
  resolution: DropResolution | null,
  zone: DropZone,
  side: DropSide,
): { section: string | null; line: string | null } {
  if (resolution === null || resolution.action === "reorder") {
    return { section: null, line: null };
  }
  const line =
    resolution.action === "move" && resolution.anchorRefId !== null
      ? `${zone.kind}:${resolution.anchorRefId}:${side}`
      : null;
  return { section: sectionKey(zone.workspaceId), line };
}
