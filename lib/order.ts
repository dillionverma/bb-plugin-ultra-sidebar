// Pure ordering math for drops and reorders.
//
// Positions are dense integers rewritten wholesale rather than fractional
// midpoints, so there is nothing to rebalance and a reorder is idempotent: the
// client computes the full post-drop list, the server stores it verbatim.
// Both sides run this same code, which is why an optimistic row never jumps
// when the server's answer arrives.
import type { Assignment, ItemKind, ItemRef, Placement } from "./types";
import { itemKey } from "./types";

export type DropSide = "before" | "after";

export interface DropTarget {
  workspaceId: string | null;
  /** The row the pointer is over, or null to append to the group. */
  anchorRefId: string | null;
  side: DropSide;
}

export function toPlacement(assignment: Assignment): Placement {
  return {
    kind: assignment.kind,
    refId: assignment.refId,
    workspaceId: assignment.workspaceId,
  };
}

/**
 * Move one item within the full placement list.
 *
 * Only placements of the same kind participate in ordering — projects and
 * threads are ordered independently inside a workspace — so an anchor of a
 * different kind degrades to "append to the group" rather than producing a
 * nonsensical interleave.
 */
export function placeItem(
  ordered: readonly Placement[],
  moved: ItemRef,
  target: DropTarget,
): Placement[] {
  const movedKey = itemKey(moved.kind, moved.refId);
  const rest = ordered.filter(
    (placement) => itemKey(placement.kind, placement.refId) !== movedKey,
  );
  const next: Placement = {
    kind: moved.kind,
    refId: moved.refId,
    workspaceId: target.workspaceId,
  };

  const anchorIndex =
    target.anchorRefId === null
      ? -1
      : rest.findIndex(
          (placement) =>
            placement.refId === target.anchorRefId &&
            placement.kind === moved.kind,
        );

  if (anchorIndex === -1) {
    // Append after the last member of the destination group, so the item lands
    // at the end of what the user sees rather than at the end of the table.
    let insertAt = rest.length;
    for (let index = rest.length - 1; index >= 0; index -= 1) {
      const candidate = rest[index]!;
      if (
        candidate.kind === moved.kind &&
        candidate.workspaceId === target.workspaceId
      ) {
        insertAt = index + 1;
        break;
      }
    }
    rest.splice(insertAt, 0, next);
    return rest;
  }

  rest.splice(target.side === "before" ? anchorIndex : anchorIndex + 1, 0, next);
  return rest;
}

/** Reorder top-level workspace sections. */
export function moveId(
  ordered: readonly string[],
  movedId: string,
  anchorId: string | null,
  side: DropSide,
): string[] {
  const rest = ordered.filter((id) => id !== movedId);
  const anchorIndex = anchorId === null ? -1 : rest.indexOf(anchorId);
  if (anchorIndex === -1) {
    rest.push(movedId);
    return rest;
  }
  rest.splice(side === "before" ? anchorIndex : anchorIndex + 1, 0, movedId);
  return rest;
}

/** True when the drop would leave everything exactly where it already is. */
export function isNoopDrop(
  ordered: readonly Placement[],
  moved: ItemRef,
  target: DropTarget,
): boolean {
  const before = ordered.map((placement) =>
    `${itemKey(placement.kind, placement.refId)}@${placement.workspaceId ?? ""}`,
  );
  const after = placeItem(ordered, moved, target).map((placement) =>
    `${itemKey(placement.kind, placement.refId)}@${placement.workspaceId ?? ""}`,
  );
  return before.length === after.length &&
    before.every((value, index) => value === after[index]);
}

/**
 * Seed positions for a whole group at once. Used when a manual drag first
 * flips a workspace out of recency ordering: without this, the dragged thread
 * gets a position and every other thread in the group falls to the unordered
 * tail, which reads as "my sidebar scrambled itself".
 */
export function seedGroupOrder(
  ordered: readonly Placement[],
  kind: ItemKind,
  workspaceId: string | null,
  memberRefIds: readonly string[],
): Placement[] {
  const inGroup = new Set(memberRefIds);
  const kept = ordered.filter(
    (placement) =>
      !(placement.kind === kind && inGroup.has(placement.refId)),
  );
  const seeded: Placement[] = memberRefIds.map((refId) => ({
    kind,
    refId,
    workspaceId,
  }));
  return [...kept, ...seeded];
}
