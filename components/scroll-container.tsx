// The one scroll area every windowed list in the sidebar measures against.
//
// The sidebar is a tree — sections, then project groups, then rows — and the
// rows are the only part that gets long. Each group windows its own rows with
// TanStack Virtual, sharing this scroll element and offsetting by where the
// group's list sits inside it (`scrollMargin`). Anything that moves a list —
// a section above collapsing, a subtree expanding — changes the content
// height, which the observer here turns into a new `version` so every group
// re-measures its offset.
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";

interface ScrollContainer {
  ref: RefObject<HTMLDivElement | null>;
  /** Bumps when the scrolled content changes height. */
  version: number;
}

const ScrollContainerContext = createContext<ScrollContainer | null>(null);

export function ScrollContainerProvider({
  scrollRef,
  contentRef,
  children,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setVersion((v) => v + 1));
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef]);
  const value = useMemo(() => ({ ref: scrollRef, version }), [scrollRef, version]);
  return (
    <ScrollContainerContext.Provider value={value}>
      {children}
    </ScrollContainerContext.Provider>
  );
}

/** How many rows past the viewport edge stay mounted, each direction. */
const OVERSCAN = 6;

/** A first guess at the viewport before it has been measured. */
const INITIAL_VIEWPORT_PX = 800;

export interface WindowedRows<T> {
  /** True when the list is windowed; false renders every row in flow. */
  active: boolean;
  /** The rows to mount, in order. */
  items: VirtualItem[];
  /** Height the list must reserve so the scrollbar stays honest. */
  totalSize: number;
  /** Where a mounted row sits, relative to the list's top. */
  offsetOf(item: VirtualItem): number;
  /** Attach to each mounted row's outer element to track its real height. */
  measure: Virtualizer<HTMLDivElement, Element>["measureElement"];
  /** Attach to the list element so its offset in the scroll area is known. */
  listRef: (element: HTMLElement | null) => void;
  /** The row behind a virtual item. */
  rowAt(item: VirtualItem): T;
}

/**
 * Window a list of rows inside the sidebar's scroll area.
 *
 * Outside a scroll container — or where the container has no size, as in
 * jsdom — the list renders in full, so tests and unusual hosts see every row.
 */
export function useWindowedRows<T>(
  rows: readonly T[],
  {
    keyOf,
    estimateSize,
  }: { keyOf(row: T): string; estimateSize(row: T): number },
): WindowedRows<T> {
  const container = useContext(ScrollContainerContext);
  const [list, setList] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The list's distance from the top of the scrolled content. Read from the
  // rects rather than offsetTop: the nearest positioned ancestor is a row's
  // `li`, not the scroll area.
  useLayoutEffect(() => {
    const scroller = container?.ref.current ?? null;
    if (list === null || scroller === null) return;
    const next =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, [list, container?.ref, container?.version]);

  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: rows.length,
    getScrollElement: () => container?.ref.current ?? null,
    estimateSize: (index) => estimateSize(rows[index]!),
    getItemKey: (index) => keyOf(rows[index]!),
    overscan: OVERSCAN,
    scrollMargin,
    initialRect: { width: 0, height: INITIAL_VIEWPORT_PX },
  });

  const items = virtualizer.getVirtualItems();
  // No scroll area, or one with no height yet: nothing to window against.
  const active = container !== null && items.length > 0;

  return {
    active,
    items,
    totalSize: virtualizer.getTotalSize(),
    offsetOf: (item) => item.start - scrollMargin,
    measure: virtualizer.measureElement,
    listRef: setList,
    rowAt: (item) => rows[item.index]!,
  };
}
