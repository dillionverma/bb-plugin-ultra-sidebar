// Live drag state lives in its own contexts, deliberately.
//
// The hover keys change as the pointer crosses rows; whether a drag is on at
// all changes twice per drag. They are separate contexts so the rows, which
// only ask the second question, are not re-rendered by the first, and the
// memoization on ThreadRow keeps paying.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DragState } from "../hooks/useSidebarDnd";
import { cn } from "@/lib/utils";

const DragActiveContext = createContext(false);
const DragHoverContext = createContext<Pick<DragState, "hoverSection" | "hoverLine">>({
  hoverSection: null,
  hoverLine: null,
});

export function DragStateProvider({
  value,
  children,
}: {
  value: DragState;
  children: ReactNode;
}) {
  const hover = useMemo(
    () => ({ hoverSection: value.hoverSection, hoverLine: value.hoverLine }),
    [value.hoverSection, value.hoverLine],
  );
  return (
    <DragActiveContext.Provider value={value.active}>
      <DragHoverContext.Provider value={hover}>{children}</DragHoverContext.Provider>
    </DragActiveContext.Provider>
  );
}

/** True while something is being dragged. */
export function useDragActive(): boolean {
  return useContext(DragActiveContext);
}

/**
 * The insertion line for a row in another section than the drag began in.
 * Inside its own section the rows slide aside instead, so nothing is drawn.
 */
export function RowDropDecor({
  kind,
  refId,
}: {
  kind: "thread" | "project";
  refId: string;
}) {
  const { hoverLine } = useContext(DragHoverContext);
  const showBefore = hoverLine === `${kind}:${refId}:before`;
  const showAfter = hoverLine === `${kind}:${refId}:after`;
  if (!showBefore && !showAfter) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        showBefore ? "top-0 -translate-y-px" : "bottom-0 translate-y-px",
      )}
    />
  );
}

/** Ring for a whole section while a drag that would land in it hovers. */
export function SectionDropDecor({ sectionKey }: { sectionKey: string }) {
  const { hoverSection } = useContext(DragHoverContext);
  if (hoverSection !== sectionKey) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-primary/60"
    />
  );
}
