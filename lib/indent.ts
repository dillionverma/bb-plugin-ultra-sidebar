// The one place the sidebar's tree geometry is decided.
//
// Nesting is unlimited, so indent cannot be `depth * step`: twenty levels at
// 14px would leave no room for a title in a sidebar that is 240-320px wide and
// that the plugin cannot measure (PluginThreadListProps exposes
// isCompactViewport, not a width). The step therefore shrinks in three
// segments, and the connector rails are derived from the same numbers rather
// than re-typed — a rail is only readable while it sits in the indent band it
// created, and two hand-written copies of the formula drift the first time
// anyone tunes it.

/** Left pad of a depth-0 row: the gap before its chevron. */
export const ROW_BASE_PAD_PX = 6;

/** The chevron button is a 16px box (`size-4`) starting at the row's pad. */
const CHEVRON_PX = 16;

/** Depths 1-3 keep the step the sidebar has always drawn. */
const FULL_STEP_PX = 14;
const FULL_LEVELS = 3;
/** Depths 4-12: still clearly stepped, less than half the width. */
const MID_STEP_PX = 6;
const MID_LEVELS = 9;
/**
 * Depth 13 and beyond, forever. Four is the floor, not two: a rail is a 1px
 * line, and 4px leaves a 3px gap so the stack of ancestor rails beside a deep
 * row stays countable instead of merging into a smear.
 */
const DEEP_STEP_PX = 4;

/**
 * The depth from which a row also carries its level as a number: the point
 * where the step reaches its 4px floor and indent alone stops being a
 * confident answer to "how deep am I".
 */
export const LEVEL_BADGE_FROM_DEPTH = FULL_LEVELS + MID_LEVELS;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Indent of a row at `depth`, in px, excluding the base pad. Strictly
 * increasing for every depth: no clamp, because a clamp makes N deep levels
 * share one indent — the bug this replaces — and collides their rails.
 */
export function indentPx(depth: number): number {
  const level = Math.max(depth, 0);
  return (
    FULL_STEP_PX * Math.min(level, FULL_LEVELS) +
    MID_STEP_PX * clamp(level - FULL_LEVELS, 0, MID_LEVELS) +
    DEEP_STEP_PX * Math.max(level - FULL_LEVELS - MID_LEVELS, 0)
  );
}

/** The row anchor's padding-left at `depth`. */
export function rowPadPx(depth: number): number {
  return ROW_BASE_PAD_PX + indentPx(depth);
}

/** How much further this depth's children are indented. */
export function stepPx(depth: number): number {
  return indentPx(depth + 1) - indentPx(depth);
}

/**
 * Where the rail under a node's children sits, in px from the row's left
 * edge. It aims at the parent's chevron centre, which is what the 14px step
 * has always drawn; once the step is narrower than half a chevron that would
 * overshoot into the child's own glyph, so it becomes the half-step instead.
 * Always strictly between rowPadPx(depth) and rowPadPx(depth + 1).
 */
export function railLeftPx(depth: number): number {
  const half = CHEVRON_PX / 2;
  const step = stepPx(depth);
  return rowPadPx(depth) + (half < step ? half : Math.ceil(step / 2));
}

/**
 * Width of the last child's elbow: from the rail to 2px inside the child's
 * chevron box, which is 8px at the 14px step — the value hardcoded before.
 */
export function railElbowPx(depth: number): number {
  return Math.max(4, rowPadPx(depth + 1) + 2 - railLeftPx(depth));
}
