// Bring the active thread's row into view after a navigation that did not
// come from the sidebar itself (Mod+[ / Mod+], the palette, a link). A row
// already fully inside the scroll area is left alone; one that is partly
// off-screen is centered; one that a windowed list has not mounted is
// scrolled to by index first, then centered once it appears.

export interface RevealRowArgs {
  getScroller(): HTMLElement | null;
  getList(): HTMLElement | null;
  threadId: string;
  /** Index of the root row whose subtree holds the thread. */
  rootIndex: number;
  scrollToIndex(index: number): void;
  schedule?(callback: () => void): number;
  cancel?(handle: number): void;
  /** Frames to wait for a windowed row to mount. */
  attempts?: number;
}

const NOOP = () => {};

export function isFullyVisible(element: Element, scroller: Element): boolean {
  const row = element.getBoundingClientRect();
  const area = scroller.getBoundingClientRect();
  return row.top >= area.top && row.bottom <= area.bottom;
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function findThreadRow(
  list: HTMLElement | null,
  threadId: string,
): HTMLElement | null {
  return (
    list?.querySelector<HTMLElement>(
      `[data-sidebar-thread-id="${escapeAttribute(threadId)}"]`,
    ) ?? null
  );
}

function centerRow(row: HTMLElement) {
  if (typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "center" });
  }
}

export function revealRow({
  getScroller,
  getList,
  threadId,
  rootIndex,
  scrollToIndex,
  schedule = (callback) => window.requestAnimationFrame(callback),
  cancel = (handle) => window.cancelAnimationFrame(handle),
  attempts = 8,
}: RevealRowArgs): () => void {
  const scroller = getScroller();
  if (scroller === null) return NOOP;

  const row = findThreadRow(getList(), threadId);
  if (row !== null) {
    if (!isFullyVisible(row, scroller)) centerRow(row);
    return NOOP;
  }

  scrollToIndex(rootIndex);
  let remaining = attempts;
  let handle: number | null = null;
  const tick = () => {
    handle = null;
    const mounted = findThreadRow(getList(), threadId);
    if (mounted !== null) {
      if (!isFullyVisible(mounted, scroller)) centerRow(mounted);
      return;
    }
    remaining -= 1;
    if (remaining > 0) handle = schedule(tick);
  };
  handle = schedule(tick);
  return () => {
    if (handle !== null) cancel(handle);
  };
}
