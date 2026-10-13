function isFullyVisible(element: Element, scroller: Element): boolean {
  const row = element.getBoundingClientRect();
  const area = scroller.getBoundingClientRect();
  return row.top >= area.top && row.bottom <= area.bottom;
}

export function revealRow(scroller: HTMLElement, threadId: string): (() => void) | undefined {
  const escapedId = threadId.replace(/["\\]/g, "\\$&");
  const tryReveal = () => {
    const row = scroller.querySelector<HTMLElement>(
      `[data-sidebar-thread-id="${escapedId}"]`,
    );
    if (row === null) return false;
    if (!isFullyVisible(row, scroller) && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "center" });
    }
    return true;
  };
  if (tryReveal()) return;

  let remaining = 8;
  let handle: number | null = null;
  const tick = () => {
    handle = null;
    if (tryReveal()) return;
    remaining -= 1;
    if (remaining > 0) handle = window.requestAnimationFrame(tick);
  };
  handle = window.requestAnimationFrame(tick);
  return () => {
    if (handle !== null) window.cancelAnimationFrame(handle);
  };
}
