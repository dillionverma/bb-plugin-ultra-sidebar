import { describe, expect, it } from "vitest";
import {
  ROW_BASE_PAD_PX,
  indentPx,
  railElbowPx,
  railLeftPx,
  rowPadPx,
  stepPx,
} from "./indent";

/** Chevron + status glyph + the two gaps, before the title can start. */
const BEFORE_TITLE_PX = 42;
/** The row's own `pr-2`. */
const ROW_END_PAD_PX = 8;

describe("indent", () => {
  it("keeps today's indent for the levels the sidebar already drew", () => {
    // The clamp used to stop here, so these four values are the whole of what
    // shipped. A ramp that changed them would restyle every existing tree
    // rather than extending past the clamp.
    expect([0, 1, 2, 3].map(indentPx)).toEqual([0, 14, 28, 42]);
    expect([0, 1, 2, 3].map(rowPadPx)).toEqual([6, 20, 34, 48]);
  });

  it("keeps stepping forever, never by less than four pixels", () => {
    for (let depth = 0; depth <= 60; depth += 1) {
      expect(indentPx(depth + 1)).toBeGreaterThan(indentPx(depth));
      expect(stepPx(depth)).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps every rail inside its own indent band", () => {
    // A rail outside its band is drawn over a row's chevron — which is what
    // the old clamp did from depth 4 down.
    for (let depth = 0; depth <= 40; depth += 1) {
      expect(railLeftPx(depth)).toBeGreaterThan(rowPadPx(depth));
      expect(railLeftPx(depth)).toBeLessThan(rowPadPx(depth + 1));
    }
    // The values that ship today, unchanged.
    expect([0, 1, 2].map(railLeftPx)).toEqual([14, 28, 42]);
    expect(railElbowPx(0)).toBe(8);
  });

  it("leaves a readable title at depth twenty in a narrow sidebar", () => {
    const used = (depth: number) =>
      ROW_BASE_PAD_PX + indentPx(depth) + BEFORE_TITLE_PX + ROW_END_PAD_PX;
    // ~96px of title left at depth 20 in a 280px sidebar.
    expect(used(20)).toBeLessThanOrEqual(280 - 90);
    // The naive formula the ramp replaces overflows the sidebar entirely.
    expect(ROW_BASE_PAD_PX + 14 * 20 + BEFORE_TITLE_PX).toBeGreaterThan(280);
  });

  it("treats a negative depth as the root", () => {
    expect(indentPx(-1)).toBe(0);
  });
});
