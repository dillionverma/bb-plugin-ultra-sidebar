// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { findThreadRow, isFullyVisible, revealRow } from "./reveal-row";

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
}

function scrollerAt(top: number, bottom: number): HTMLElement {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => rect(top, bottom);
  return scroller;
}

function rowAt(list: HTMLElement, threadId: string, top: number, bottom: number) {
  const row = document.createElement("a");
  row.setAttribute("data-sidebar-thread-id", threadId);
  row.getBoundingClientRect = () => rect(top, bottom);
  row.scrollIntoView = vi.fn();
  list.append(row);
  return row;
}

function scheduler() {
  const queue: Array<{ handle: number; callback: () => void }> = [];
  let next = 1;
  return {
    schedule: (callback: () => void) => {
      const handle = next++;
      queue.push({ handle, callback });
      return handle;
    },
    cancel: (handle: number) => {
      const index = queue.findIndex((entry) => entry.handle === handle);
      if (index !== -1) queue.splice(index, 1);
    },
    flush() {
      const pending = queue.splice(0);
      for (const entry of pending) entry.callback();
    },
    get pending() {
      return queue.length;
    },
  };
}

describe("reveal row", () => {
  it("leaves a fully visible row alone", () => {
    const scroller = scrollerAt(0, 500);
    const list = document.createElement("ul");
    const row = rowAt(list, "thr_a", 100, 140);
    const scrollToIndex = vi.fn();

    revealRow({ getScroller: () => scroller, getList: () => list, threadId: "thr_a", rootIndex: 3, scrollToIndex });

    expect(row.scrollIntoView).not.toHaveBeenCalled();
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("centers a mounted row that is partly off-screen", () => {
    const scroller = scrollerAt(0, 500);
    const list = document.createElement("ul");
    const row = rowAt(list, "thr_a", 480, 520);

    revealRow({ getScroller: () => scroller, getList: () => list, threadId: "thr_a", rootIndex: 0, scrollToIndex: vi.fn() });

    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("scrolls a windowed list to the root index, then centers the row once it mounts", () => {
    const scroller = scrollerAt(0, 500);
    const list = document.createElement("ul");
    const scrollToIndex = vi.fn();
    const frames = scheduler();

    revealRow({
      getScroller: () => scroller,
      getList: () => list,
      threadId: "thr_child",
      rootIndex: 42,
      scrollToIndex,
      schedule: frames.schedule,
      cancel: frames.cancel,
    });

    expect(scrollToIndex).toHaveBeenCalledWith(42);
    frames.flush();
    expect(frames.pending).toBe(1);
    const row = rowAt(list, "thr_child", -30, 10);
    frames.flush();
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(frames.pending).toBe(0);
  });

  it("gives up after the configured number of frames and can be cancelled", () => {
    const scroller = scrollerAt(0, 500);
    const list = document.createElement("ul");
    const frames = scheduler();
    const args = {
      getScroller: () => scroller,
      getList: () => list,
      threadId: "thr_missing",
      rootIndex: 1,
      scrollToIndex: vi.fn(),
      schedule: frames.schedule,
      cancel: frames.cancel,
      attempts: 2,
    };

    revealRow(args);
    frames.flush();
    frames.flush();
    expect(frames.pending).toBe(0);

    const cancel = revealRow(args);
    expect(frames.pending).toBe(1);
    cancel();
    expect(frames.pending).toBe(0);
  });

  it("does nothing without a scroll area", () => {
    const scrollToIndex = vi.fn();
    revealRow({ getScroller: () => null, getList: () => null, threadId: "thr_a", rootIndex: 0, scrollToIndex });
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("finds rows by escaped thread id and measures visibility against the scroller", () => {
    const list = document.createElement("ul");
    const row = rowAt(list, 'thr_"quoted"', 0, 10);
    expect(findThreadRow(list, 'thr_"quoted"')).toBe(row);
    expect(findThreadRow(list, "thr_other")).toBeNull();
    expect(isFullyVisible(row, scrollerAt(0, 10))).toBe(true);
    expect(isFullyVisible(row, scrollerAt(5, 100))).toBe(false);
  });
});
