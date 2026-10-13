// Pure ordering math for drops and reorders.
//
// Positions are dense integers rewritten wholesale rather than fractional
// midpoints, so there is nothing to rebalance and a reorder is idempotent: the
// client computes the full post-drop list, the server stores it verbatim.
// Both sides run this same code, which is why an optimistic row never jumps
// when the server's answer arrives.
import type { ItemKind, ItemRef, OrderEntry, Placement } from "./types";
import { itemKey } from "./types";

export type DropSide = "before" | "after";

export interface DropTarget {
  /** The row the pointer is over, or null to append to the end. */
  anchorRefId: string | null;
  side: DropSide;
}

export function toPlacement(entry: OrderEntry): Placement {
  return { kind: entry.kind, refId: entry.refId };
}

/**
 * Move one item within the full placement list.
 *
 * Only placements of the same kind participate in ordering — projects and
 * threads order independently — so an anchor of a different kind degrades to
 * "append" rather than producing a nonsensical interleave.
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
  const next: Placement = { kind: moved.kind, refId: moved.refId };

  const anchorIndex =
    target.anchorRefId === null
      ? -1
      : rest.findIndex(
          (placement) =>
            placement.refId === target.anchorRefId &&
            placement.kind === moved.kind,
        );

  if (anchorIndex === -1) {
    rest.push(next);
    return rest;
  }

  rest.splice(target.side === "before" ? anchorIndex : anchorIndex + 1, 0, next);
  return rest;
}

/** Reorder a list of ids around an anchor. */
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

/**
 * Seed positions for a whole section at once. Used when a manual drag first
 * takes a section out of recency ordering: without this, the dragged thread
 * gets a position and every other thread in the section keeps none, so the
 * rest would sort above it as "never placed by hand" — which reads as the
 * sidebar scrambling itself.
 *
 * The members land at the end of the global list. Only rows inside one
 * section are ever compared, so where the block sits among other sections'
 * positions never shows.
 */
export function seedGroupOrder(
  ordered: readonly Placement[],
  kind: ItemKind,
  memberRefIds: readonly string[],
): Placement[] {
  const inGroup = new Set(memberRefIds);
  const kept = ordered.filter(
    (placement) => !(placement.kind === kind && inGroup.has(placement.refId)),
  );
  const seeded: Placement[] = memberRefIds.map((refId) => ({ kind, refId }));
  return [...kept, ...seeded];
}

/** Drop hand-picked positions, so these items sort by recency again. */
export function clearGroupOrder(
  ordered: readonly Placement[],
  kind: ItemKind,
  memberRefIds: readonly string[],
): Placement[] {
  const inGroup = new Set(memberRefIds);
  return ordered.filter(
    (placement) => !(placement.kind === kind && inGroup.has(placement.refId)),
  );
}
