// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealRow } from "./reveal-row";

function rect(top: number, bottom: number): DOMRect {
  return new DOMRect(0, top, 0, bottom - top);
}

function scrollerAt(top: number, bottom: number): HTMLElement {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => rect(top, bottom);
  return scroller;
}

function rowAt(scroller: HTMLElement, threadId: string, top: number, bottom: number) {
  const row = document.createElement("a");
  row.setAttribute("data-sidebar-thread-id", threadId);
  row.getBoundingClientRect = () => rect(top, bottom);
  row.scrollIntoView = vi.fn();
  scroller.append(row);
  return row;
}

describe("reveal row", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves a fully visible row alone", () => {
    const scroller = scrollerAt(0, 500);
    const row = rowAt(scroller, "thr_a", 100, 140);

    revealRow(scroller, "thr_a");

    expect(row.scrollIntoView).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("centers a mounted row that is partly off-screen", () => {
    const scroller = scrollerAt(0, 500);
    const row = rowAt(scroller, "thr_a", 480, 520);

    revealRow(scroller, "thr_a");

    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a descendant to mount after its ancestor chain opens", () => {
    const scroller = scrollerAt(0, 500);

    revealRow(scroller, "thr_child");

    vi.advanceTimersToNextFrame();
    expect(vi.getTimerCount()).toBe(1);
    const row = rowAt(scroller, "thr_child", -30, 10);
    vi.advanceTimersToNextFrame();
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying after eight frames", () => {
    const scroller = scrollerAt(0, 500);
    const query = vi.spyOn(scroller, "querySelector");

    revealRow(scroller, "thr_missing");
    for (let frame = 0; frame < 8; frame += 1) vi.advanceTimersToNextFrame();

    expect(query).toHaveBeenCalledTimes(9);
    expect(vi.getTimerCount()).toBe(0);
    const row = rowAt(scroller, "thr_missing", -30, 10);
    vi.advanceTimersToNextFrame();
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when navigation changes", () => {
    const scroller = scrollerAt(0, 500);
    const cancel = revealRow(scroller, "thr_child");
    vi.advanceTimersToNextFrame();

    cancel?.();
    const row = rowAt(scroller, "thr_child", -30, 10);
    vi.advanceTimersToNextFrame();

    expect(row.scrollIntoView).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reveals only the matching escaped thread id", () => {
    const scroller = scrollerAt(0, 500);
    const other = rowAt(scroller, "thr_other", -30, 10);
    const row = rowAt(scroller, 'thr_"quoted"\\path', -30, 10);

    revealRow(scroller, 'thr_"quoted"\\path');

    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(other.scrollIntoView).not.toHaveBeenCalled();
  });
});
