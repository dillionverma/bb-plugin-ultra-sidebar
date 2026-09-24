// What a drop means, free of DOM and React.
//
// dnd-kit owns the gesture: the sensors, the row that follows the pointer,
// autoscroll, the rows sliding aside inside a list. What it cannot know is the
// sidebar's rules — a thread can be filed into a status bucket or pinned, but
// never dragged into another project — so every draggable and droppable
// carries a DropZone, and resolveDrop turns the pair under the pointer into an
// action, or null for a hover that means nothing.
import type { ItemKind } from "./types";
import { PINNED_SECTION_ID, projectFromSectionId } from "./sections";
import {
  bucketFromSectionId,
  canFileInto,
  isFinished,
  type StatusBucket,
} from "./status";

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

export type DragKind = ItemKind | "section";

/** A row or section: what can sit under the pointer, or be picked up. */
export interface DropZone {
  kind: DragKind;
  /** The row's id; for a section zone, the section's own id. */
  refId: string | null;
  /** The section the zone belongs to. */
  sectionId: string;
  /**
   * For a thread row, the project it belongs to. A drop cannot change it,
   * and knowing it is what tells "back into its own project" — a real drop —
   * from "into somebody else's", which is not one.
   */
  projectId?: string | null;
}

/** The zone that was picked up. A zone with no id can never be one. */
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

/**
 * What a drop would do, as the state the row ends up in rather than a verb.
 *
 * One shape for every drop, because the destination heading is what decides:
 * landing in a bucket files the thread, landing in Pinned pins it, landing
 * back in its own project does both in reverse. A caller that had to switch
 * on a verb would keep missing the combinations.
 */
export interface DropResolution {
  /** The section the row ends up in. */
  sectionId: string;
  /** The row it lands beside, or null for the end of that list. */
  anchorRefId: string | null;
  /**
   * True when nothing but the order changes. The rows in that list already
   * slid aside under the pointer, so the hover draws no extra decoration.
   */
  reorder: boolean;
  /** The pin state to set, or null to leave it alone. */
  pin: boolean | null;
  /**
   * The bucket to file the thread in, or null to leave its status alone.
   * "in-progress" is not a hand-set status: it clears one, handing the
   * thread back to its own pull request.
   */
  bucket: StatusBucket | null;
}

/** The zone a project heading would reorder against, or null. */
function projectDrop(source: DragSource, zone: DropZone): DropResolution | null {
  if (zone.kind !== "project" || zone.refId === null) return null;
  if (zone.refId === source.refId) return null;
  return {
    sectionId: zone.sectionId,
    anchorRefId: zone.refId,
    reorder: true,
    pin: null,
    bucket: null,
  };
}

/**
 * Decide what dropping `source` on `zone` would do, or null when nothing.
 *
 * A thread reorders freely inside its own section. Across sections the drop
 * means whatever the destination heading means: a status bucket files it,
 * Pinned pins it, and its own project takes it back — unpinned, and off any
 * parked pile it was on. Another project's heading means nothing, because a
 * drag cannot change which project a thread belongs to and pretending
 * otherwise would be a lie. The In review heading means nothing for the same
 * reason: it is a fact about a pull request, not a pile to put things in.
 */
export function resolveDrop(
  source: DragSource,
  zone: DropZone,
): DropResolution | null {
  if (source.kind === "project") return projectDrop(source, zone);

  // Only the destination section matters: a heading, an empty section and a
  // row of another kind all mean "this section". The row under the pointer
  // adds a position only when it is another thread.
  const anchorRefId =
    zone.kind === "thread" && zone.refId !== null && zone.refId !== source.refId
      ? zone.refId
      : null;

  if (zone.sectionId === source.sectionId) {
    // Landing on the section itself, or on the row being dragged, is not a
    // move: the rows have not gone anywhere.
    if (anchorRefId === null) return null;
    return {
      sectionId: zone.sectionId,
      anchorRefId,
      reorder: true,
      pin: null,
      bucket: null,
    };
  }

  const wasPinned = source.sectionId === PINNED_SECTION_ID;
  if (zone.sectionId === PINNED_SECTION_ID) {
    // A finished thread is never shown pinned, so pinning one reopens it;
    // otherwise it would be pinned and stay exactly where it was.
    const from = bucketFromSectionId(source.sectionId);
    return {
      sectionId: PINNED_SECTION_ID,
      anchorRefId,
      reorder: false,
      pin: true,
      bucket: from !== null && isFinished(from) ? "in-progress" : null,
    };
  }

  const bucket = bucketFromSectionId(zone.sectionId);
  if (bucket !== null) {
    // Refusing the drop here is what keeps the ring dark over In review, so
    // the gesture reads as impossible rather than as one that appeared to
    // land and then filed the thread somewhere else.
    if (!canFileInto(bucket)) return null;
    return {
      sectionId: zone.sectionId,
      anchorRefId,
      reorder: false,
      pin: wasPinned ? false : null,
      bucket,
    };
  }

  // A project section. Only the thread's own takes it, and landing there
  // means "back to work here": unpinned, and off whatever parked pile it
  // was on.
  const project = projectFromSectionId(zone.sectionId);
  if (project === null || project !== source.projectId) return null;
  return {
    sectionId: zone.sectionId,
    anchorRefId,
    reorder: false,
    pin: wasPinned ? false : null,
    bucket: bucketFromSectionId(source.sectionId) === null ? null : "in-progress",
  };
}

/**
 * The decorations a hover lights up. A reorder inside one list needs none —
 * the rows sliding aside already say where the drop lands — while a move
 * rings the target section, with a line at the row when there is one.
 */
export function hoverKeys(
  resolution: DropResolution | null,
  zone: DropZone,
  side: DropSide,
): { section: string | null; line: string | null } {
  if (resolution === null || resolution.reorder) {
    return { section: null, line: null };
  }
  const line =
    resolution.anchorRefId !== null
      ? `${zone.kind}:${resolution.anchorRefId}:${side}`
      : null;
  return { section: sectionKey(resolution.sectionId), line };
}

/** dnd-kit ids must be unique across every list in the sidebar. */
export function sortableId(zone: DropZone): string {
  switch (zone.kind) {
    case "thread":
      // A thread shows in exactly one section at a time, but the section is
      // part of the id anyway so a regroup never reuses a stale node.
      return `thread:${zone.sectionId}:${zone.refId ?? ""}`;
    case "project":
      // Falls back to the section when there is no project: a status or
      // Pinned heading registers an inert project node, and two of those
      // sharing one id would be two dnd-kit droppables with the same key.
      return `project:${zone.refId ?? zone.sectionId}`;
    case "section":
      return `section:${zone.sectionId}`;
  }
}

/** The key a section's drop ring compares against. */
export function sectionKey(sectionId: string): string {
  return `section:${sectionId}`;
}

