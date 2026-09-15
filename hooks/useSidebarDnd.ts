// The sidebar's dnd-kit configuration: sensors, collisions, and the bridge
// from "what is under the pointer" to "what the drop does".
//
// dnd-kit moves the rows; the rules live in lib/dnd.ts. What this hook adds
// is the sidebar's coexistence with bb's own drag-to-split gesture: a press
// that heads sideways before it has moved down is left to the host, and once
// the host engages it dispatches Escape, which dnd-kit treats as cancel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
  type Modifier,
  type Over,
} from "@dnd-kit/core";
import {
  ENGAGE_PX,
  SPLIT_TOLERANCE_PX,
  SPRING_LOAD_MS,
  TOUCH_HOLD_MS,
  hoverKeys,
  resolveDrop,
  sourceOf,
  type DndData,
  type DragSource,
  type DropResolution,
  type DropSide,
} from "../lib/dnd";

export interface DropOutcome {
  source: DragSource;
  resolution: DropResolution;
  /** Which half of the anchor row the item was released over. */
  side: DropSide;
}

export interface DragState {
  active: boolean;
  /** Section ring to light, or null. */
  hoverSection: string | null;
  /** Row insertion line to light, or null. */
  hoverLine: string | null;
}

export const IDLE_DRAG: DragState = {
  active: false,
  hoverSection: null,
  hoverLine: null,
};

/** Same object when nothing changed, so context consumers stay put. */
function settle(prev: DragState, next: DragState): DragState {
  return prev.active === next.active &&
    prev.hoverSection === next.hoverSection &&
    prev.hoverLine === next.hoverLine
    ? prev
    : next;
}

/** Only the props the DndContext needs from here; the rest is the caller's. */
export type SidebarDndContextProps = Pick<
  DndContextProps,
  | "sensors"
  | "collisionDetection"
  | "modifiers"
  | "onDragStart"
  | "onDragOver"
  | "onDragEnd"
  | "onDragCancel"
>;

export function useSidebarDnd(options: {
  onDrop(outcome: DropOutcome): void;
  isCollapsed(workspaceId: string | null): boolean;
  onSpringLoad(workspaceId: string | null): void;
}): { state: DragState; contextProps: SidebarDndContextProps } {
  const [state, setState] = useState<DragState>(IDLE_DRAG);

  // Held in a ref so the handlers below stay identity-stable; the DndContext
  // re-binds nothing when a callback changes.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const springRef = useRef<{ key: string; timer: number } | null>(null);
  const clearSpring = useCallback(() => {
    if (springRef.current !== null) window.clearTimeout(springRef.current.timer);
    springRef.current = null;
  }, []);
  useEffect(() => clearSpring, [clearSpring]);

  const sensors = useSensors(
    // A mouse press needs real downward travel; sideways travel first means
    // the host's split gesture, and the constraint aborts so it can have it.
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: { y: ENGAGE_PX },
        tolerance: { x: SPLIT_TOLERANCE_PX },
      },
    }),
    // A touch has to be held: a swipe is a scroll, not a drag.
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: 8 },
    }),
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    if (sourceOf(dataOf(event.active)) === null) return;
    setState({ active: true, hoverSection: null, hoverLine: null });
  }, []);

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const source = sourceOf(dataOf(event.active));
      const target = event.over === null ? null : dataOf(event.over);
      if (source === null || target === null) {
        clearSpring();
        setState((prev) =>
          settle(prev, { active: true, hoverSection: null, hoverLine: null }),
        );
        return;
      }
      const side = sideOf(event.active, event.over!);
      const resolution = resolveDrop(source, target.zone);
      const keys = hoverKeys(resolution, target.zone, side);
      setState((prev) =>
        settle(prev, { active: true, hoverSection: keys.section, hoverLine: keys.line }),
      );

      // Spring-load: pausing over a collapsed section opens it, so a target
      // that is only a header can still take a precise placement.
      const { zone } = target;
      if (
        zone.kind === "workspace" &&
        optionsRef.current.isCollapsed(zone.workspaceId)
      ) {
        const key = String(event.over!.id);
        if (springRef.current?.key !== key) {
          clearSpring();
          springRef.current = {
            key,
            timer: window.setTimeout(() => {
              springRef.current = null;
              optionsRef.current.onSpringLoad(zone.workspaceId);
            }, SPRING_LOAD_MS),
          };
        }
      } else {
        clearSpring();
      }
    },
    [clearSpring],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearSpring();
      setState(IDLE_DRAG);
      const source = sourceOf(dataOf(event.active));
      const target = event.over === null ? null : dataOf(event.over);
      if (source === null || target === null) return;
      const resolution = resolveDrop(source, target.zone);
      if (resolution === null) return;
      optionsRef.current.onDrop({
        source,
        resolution,
        side: sideOf(event.active, event.over!),
      });
    },
    [clearSpring],
  );

  const onDragCancel = useCallback(() => {
    clearSpring();
    setState(IDLE_DRAG);
  }, [clearSpring]);

  const contextProps = useMemo<SidebarDndContextProps>(
    () => ({
      sensors,
      collisionDetection,
      modifiers: MODIFIERS,
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel,
    }),
    [sensors, onDragStart, onDragOver, onDragEnd, onDragCancel],
  );

  return { state, contextProps };
}

/**
 * Wrap dnd-kit's handle listeners so a press on a control inside the row —
 * the chevron, a hover action, the rename field — stays a press on it.
 */
export function guardHandle(
  listeners: DraggableSyntheticListeners,
): DraggableSyntheticListeners {
  if (listeners === undefined) return undefined;
  const guarded: Record<string, (event: { target: EventTarget | null }) => void> = {};
  for (const [name, handler] of Object.entries(listeners)) {
    guarded[name] = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(CONTROL_SELECTOR) !== null) {
        return;
      }
      (handler as (event: unknown) => void)(event);
    };
  }
  return guarded;
}

const CONTROL_SELECTOR = "button, input, textarea, select, [data-no-drag]";

function dataOf(entry: Active | Over): DndData | null {
  const data = entry.data.current as DndData | undefined;
  return data === undefined ? null : data;
}

/** Which half of the hovered row the dragged row's centre is in. */
function sideOf(active: Active, over: Over): DropSide {
  const moving = active.rect.current.translated;
  if (moving === null) return "after";
  const centre = moving.top + moving.height / 2;
  return centre < over.rect.top + over.rect.height / 2 ? "before" : "after";
}

const RANK: Record<DndData["zone"]["kind"], number> = {
  thread: 0,
  project: 1,
  workspace: 2,
};

/**
 * Rows over sections: the pointer is usually inside both a row and the
 * section around it, and the row is the answer. A workspace drag sees only
 * workspace headers, measured by centre so tall sections still sort cleanly.
 */
const collisionDetection: CollisionDetection = (args) => {
  if (sourceOf(dataOf(args.active))?.kind === "workspace") {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) =>
          (container.data.current as DndData | undefined)?.zone.kind ===
          "workspace",
      ),
    });
  }
  const within = pointerWithin(args);
  return [...within].sort((a, b) => rankOf(a) - rankOf(b));
};

function rankOf(collision: ReturnType<CollisionDetection>[number]): number {
  const data = collision.data?.droppableContainer?.data.current as
    | DndData
    | undefined;
  return data === undefined ? 99 : RANK[data.zone.kind];
}

/** The list is a column; the row never leaves it sideways. */
const restrictToVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [restrictToVertical];
