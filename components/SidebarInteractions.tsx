import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Icon } from "./ui/icon";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type HTMLAttributes,
} from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "./ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { useSidebar } from "./sidebar-context";
import type { UndoHistory } from "../lib/history";

const ROW = "[data-sidebar-thread-shortcut-target]";
export function isEditing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"],.monaco-editor,.xterm',
    )
  );
}
const Selection = createContext<{
  selected: Set<string>;
  active: boolean;
  enter(): void;
  exit(): void;
  selectAll(): void;
  click(id: string, event: MouseEvent): boolean;
  toggle(id: string, range?: boolean): void;
}>({
  selected: new Set<string>(),
  active: false,
  enter: () => {},
  exit: () => {},
  selectAll: () => {},
  click: (_id: string, _event: MouseEvent) => false,
  toggle: () => {},
});
export const useSidebarSelection = () => useContext(Selection);

// Filter before invoking Radix's trigger handlers. preventDefault would also
// suppress the browser's editing menu, while capture/stopPropagation would
// break the context menus owned by rows and controls below this surface.
const SidebarSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ onContextMenu, onPointerDown, ...props }, ref) => {
    const isBackground = (target: EventTarget | null) =>
      target instanceof Element &&
      !isEditing(target) &&
      !target.closest(
        `${ROW},button,a,[role="button"],[role="menu"],[role="dialog"],[data-sidebar-context-boundary]`,
      );
    return (
      <div
        {...props}
        ref={ref}
        onContextMenu={(event) => {
          if (isBackground(event.target)) onContextMenu?.(event);
        }}
        onPointerDown={(event) => {
          if (isBackground(event.target)) onPointerDown?.(event);
        }}
      />
    );
  },
);
SidebarSurface.displayName = "SidebarSurface";
const shortcuts = [
  ["Ctrl/Cmd Z", "Undo last sidebar action"],
  ["Ctrl/Cmd Shift Z", "Redo"],
  ["↑ / ↓", "Focus previous / next thread"],
  ["Enter", "Open thread"],
  ["Shift Enter", "Open thread in split"],
  ["F2", "Rename focused thread"],
  ["D", "Mark done / reopen"],
  ["M", "Move selected threads to workspace"],
  ["S", "Snooze selected threads until tomorrow at 9am"],
  ["Alt ↑ / ↓", "Reorder focused thread"],
  ["Ctrl/Cmd click", "Toggle selection"],
  ["Space", "Select focused thread"],
  ["Shift click / Shift ↑ ↓", "Select a range"],
  ["Ctrl/Cmd A", "Select visible threads"],
  ["Escape", "Clear selection / close dialog"],
  ["?", "Show these shortcuts"],
];

export function SidebarInteractions({
  history,
  batch,
  children,
  threadIds,
  onNewThread,
  onNewWorkspace,
  onCollapseAll,
  onExpandAll,
  onViewOptions,
}: {
  history: UndoHistory;
  batch(label: string, action: () => void): void;
  children: ReactNode;
  /** All existing ids, including collapsed or filtered-out rows. */
  threadIds?: readonly string[];
  onNewThread?(): void;
  onNewWorkspace?(): void;
  onCollapseAll?(): void;
  onExpandAll?(): void;
  onViewOptions?(): void;
}) {
  const sidebar = useSidebar();
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [active, setActive] = useState(false);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const skipBackgroundFocusRestore = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const anchor = useRef<string | null>(null);
  const [help, setHelp] = useState(false);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const rows = () =>
    Array.from(root.current?.querySelectorAll<HTMLAnchorElement>(ROW) ?? []);
  const ids = () => rows().map((row) => row.dataset.sidebarThreadId!);
  const exit = () => {
    setSelected(new Set());
    setActive(false);
    setActionsOpen(false);
    anchor.current = null;
  };
  const selectAll = () => {
    const shown = ids();
    setActive(shown.length > 0);
    setSelected(new Set(shown));
    anchor.current = shown[0] ?? null;
  };
  const selectRange = (id: string) => {
    const order = ids();
    anchor.current ??= id;
    const start = order.indexOf(anchor.current ?? id);
    const end = order.indexOf(id);
    if (end < 0) return;
    setActive(true);
    setSelected(
      new Set(
        order.slice(
          Math.min(start < 0 ? end : start, end),
          Math.max(start, end) + 1,
        ),
      ),
    );
  };
  const toggle = (id: string, range = false) => {
    setActive(true);
    if (range) {
      selectRange(id);
      return;
    }
    anchor.current = id;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const click = (id: string, event: MouseEvent) => {
    if (event.shiftKey) {
      selectRange(id);
      return true;
    }
    if (event.metaKey || event.ctrlKey || active) {
      toggle(id);
      return true;
    }
    exit();
    anchor.current = id;
    return false;
  };
  const targets = (id?: string) =>
    selectedRef.current.size && (!id || selectedRef.current.has(id))
      ? [...selectedRef.current]
      : id
        ? [id]
        : [];
  const status = (threadIds: string[], reopen: boolean) => {
    batch(reopen ? "Threads reopened" : "Marked done", () =>
      threadIds.forEach((id) => sidebar.setStatus(id, reopen ? null : "done")),
    );
    exit();
  };
  const snooze = (threadIds: string[]) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    batch("Threads snoozed until tomorrow", () =>
      threadIds.forEach((id) => sidebar.setSnoozed(id, tomorrow.getTime())),
    );
    exit();
  };
  const move = (workspaceId: string | null) => {
    batch("Moved to workspace", () =>
      moveIds?.forEach((id) =>
        sidebar.moveTo({ kind: "thread", refId: id }, workspaceId),
      ),
    );
    setMoveIds(null);
    exit();
  };

  useEffect(() => {
    if (!threadIds) return;
    const existing = new Set(threadIds);
    setSelected((previous) => {
      const kept = new Set([...previous].filter((id) => existing.has(id)));
      return kept.size === previous.size ? previous : kept;
    });
  }, [threadIds]);

  useEffect(() => {
    if (!active) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || root.current?.contains(target)) return;
      // Menus and responsive sheets portal outside the sidebar. Keep the
      // selection available while choosing an action or dismissing its sheet.
      if (target.closest('[data-bb-portaled-overlay],[role="dialog"],[role="menu"]')) return;
      exit();
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [active]);

  // Remember the old visual order, so hiding the focused row lands on the next
  // surviving row (then the previous one) without opening a different thread.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let order = ids();
    setShownIds(order);
    let focused: string | null = null;
    const focus = (event: FocusEvent) => {
      focused =
        event.target instanceof Element
          ? (event.target.closest<HTMLElement>(ROW)?.dataset.sidebarThreadId ??
            null)
          : null;
      order = ids();
    };
    el.addEventListener("focusin", focus);
    const observer = new MutationObserver(() => {
      const next = ids();
      if (focused && !next.includes(focused)) {
        const index = order.indexOf(focused);
        const candidate = [
          ...order.slice(index + 1),
          ...order.slice(0, index).reverse(),
        ].find((id) => next.includes(id));
        if (
          document.activeElement === document.body ||
          document.activeElement === el
        ) {
          (
            rows().find((row) => row.dataset.sidebarThreadId === candidate) ??
            el
          ).focus();
        }
        focused = candidate ?? null;
      } else if (focused && document.activeElement === document.body) {
        rows()
          .find((row) => row.dataset.sidebarThreadId === focused)
          ?.focus();
      }
      order = next;
      setShownIds((previous) =>
        previous.length === next.length && previous.every((id, i) => id === next[i])
          ? previous
          : next,
      );
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("focusin", focus);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isEditing(event.target)
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"],[role="menu"]')) return;
      const inside = !!target && !!root.current?.contains(target);
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (
        mod &&
        !event.altKey &&
        (key === "z" || (key === "y" && event.ctrlKey))
      ) {
        // Outside this sidebar, only act when the host has no focused control.
        if (!inside && target !== document.body) return;
        if (key === "y" || event.shiftKey) {
          if (!history.future.length && !history.pending) return;
          void history.redo();
        } else {
          if (!history.past.length && !history.pending) return;
          void history.undo();
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!inside) return;
      const row = target?.closest<HTMLAnchorElement>(ROW);
      const id = row?.dataset.sidebarThreadId;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (key === "escape") {
        if (!active && !selected.size) return;
        exit();
        handled();
        return;
      }
      if (key === "?") {
        setHelp(true);
        handled();
        return;
      }
      if (mod && key === "a") {
        selectAll();
        handled();
        return;
      }
      if (!row || !id || mod || event.altKey || target !== row) return;
      if (key === " ") {
        toggle(id, event.shiftKey);
        handled();
      } else if (key === "arrowdown" || key === "arrowup") {
        const list = rows();
        const next = list[list.indexOf(row) + (key === "arrowdown" ? 1 : -1)];
        if (next) {
          if (event.shiftKey) {
            anchor.current ??= id;
            selectRange(next.dataset.sidebarThreadId!);
          } else anchor.current = next.dataset.sidebarThreadId!;
          next.focus();
        }
        handled();
      } else if (key === "enter" && event.shiftKey) {
        sidebar.openThread(id, true);
        handled();
      } else if (key === "d") {
        status(targets(id), row.dataset.sidebarBucket === "done");
        handled();
      } else if (key === "s") {
        snooze(targets(id));
        handled();
      } else if (key === "m") {
        setQuery("");
        setMoveIds(targets(id));
        handled();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const hiddenCount = [...selected].filter((id) => !shownIds.includes(id)).length;
  const enter = () => setActive(true);
  const launchFromBackground = (action: () => void) => {
    // These actions create their own focus target. Restoring focus to the
    // old menu trigger afterward would blur and submit the workspace input.
    skipBackgroundFocusRestore.current = true;
    action();
  };

  return (
    <Selection.Provider value={{ selected, active, enter, exit, selectAll, click, toggle }}>
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <SidebarSurface
        ref={root}
        tabIndex={-1}
        aria-label="Workspace threads"
        className={cn("bb-workspace-sidebar relative flex h-full min-h-0 flex-col", active && "bb-ws-selecting")}
      >
        {history.pending > 0 && (
          <span role="status" className="sr-only">
            Saving changes
          </span>
        )}
        {children}
        {selected.size > 0 && (
          <div data-sidebar-selection-footer="" className="flex shrink-0 justify-center px-2 pb-2 pt-1">
            <div
              role="toolbar"
              aria-label="Selected threads"
              className="flex max-w-full items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              <span
                className="flex min-w-0 flex-col px-2 text-xs tabular-nums"
                role="status"
              >
                <span className="whitespace-nowrap">{selected.size} selected</span>
                {hiddenCount > 0 && <span className="text-[10px] text-muted-foreground">{hiddenCount} hidden</span>}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 rounded-lg px-2"
                disabled={history.pending > 0}
                onClick={() => status(targets(), false)}
              >
                <Icon name="Check" />
                Mark done
              </Button>
              <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-7 rounded-lg p-0"
                    aria-label="More selection actions"
                  >
                    <Icon name="MoreHorizontal" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  className="flex w-44 flex-col gap-1 p-1"
                  mobileTitle="Selected threads"
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      setActionsOpen(false);
                      setQuery("");
                      setMoveIds(targets());
                    }}
                  >
                    <Icon name="FolderExport" />
                    Move to workspace…
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      setActionsOpen(false);
                      status(targets(), true);
                    }}
                  >
                    <Icon name="Spinner" />
                    Reopen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      setActionsOpen(false);
                      snooze(targets());
                    }}
                  >
                    <Icon name="Clock" />
                    Snooze until tomorrow
                  </Button>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="ghost"
                className="size-7 rounded-lg p-0"
                aria-label="Clear selection"
                onClick={exit}
              >
                <Icon name="X" />
              </Button>
            </div>
          </div>
        )}
      </SidebarSurface>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="sidebar-context-menu w-56"
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (!skipBackgroundFocusRestore.current) return;
          event.preventDefault();
          skipBackgroundFocusRestore.current = false;
        }}
      >
        <ContextMenuLabel>Sidebar</ContextMenuLabel>
        {onNewThread && <ContextMenuItem onSelect={() => launchFromBackground(onNewThread)}><Icon name="MessageSquarePlus" />New thread</ContextMenuItem>}
        {onNewWorkspace && <ContextMenuItem onSelect={() => launchFromBackground(onNewWorkspace)}><Icon name="FolderPlus" />New workspace</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={active ? exit : enter}>
          <Icon name="ListTodo" />{active ? "Exit selection" : "Select threads"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={selectAll} disabled={shownIds.length === 0}>
          <Icon name="Check" />Select all shown<ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
        {selected.size > 0 && <ContextMenuItem onSelect={exit}><Icon name="X" />Clear selection<ContextMenuShortcut>Esc</ContextMenuShortcut></ContextMenuItem>}
        {(onCollapseAll || onExpandAll || onViewOptions) && <ContextMenuSeparator />}
        {onCollapseAll && <ContextMenuItem onSelect={onCollapseAll}><Icon name="ChevronsUp" />Collapse all</ContextMenuItem>}
        {onExpandAll && <ContextMenuItem onSelect={onExpandAll}><Icon name="ChevronsDown" />Expand all</ContextMenuItem>}
        {onViewOptions && <ContextMenuItem onSelect={() => launchFromBackground(onViewOptions)}><Icon name="SlidersHorizontal" />View options…</ContextMenuItem>}
      </ContextMenuContent>
      </ContextMenu>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogTitle>Sidebar shortcuts</DialogTitle>
          <DialogDescription>
            Thread shortcuts apply while a sidebar row is focused. Text fields
            keep their normal editing shortcuts.
          </DialogDescription>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {shortcuts.map(([keys, label]) => (
              <div key={keys} className="contents">
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
      <Dialog
        open={moveIds !== null}
        onOpenChange={(open) => {
          if (!open) setMoveIds(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            Move{" "}
            {moveIds?.length === 1
              ? "thread"
              : `${moveIds?.length ?? 0} threads`}
          </DialogTitle>
          <DialogDescription>Choose a workspace.</DialogDescription>
          <Input
            autoFocus
            aria-label="Find workspace"
            placeholder="Find workspace…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex max-h-64 flex-col overflow-y-auto">
            {sidebar.workspaces
              .filter((w) => w.name.toLowerCase().includes(query.toLowerCase()))
              .map((w) => (
                <Button
                  size="sm"
                  variant="ghost"
                  key={w.id}
                  className="justify-start"
                  onClick={() => move(w.id)}
                >
                  {w.name}
                </Button>
              ))}
            {"unassigned".includes(query.toLowerCase()) && (
              <Button
                size="sm"
                variant="ghost"
                className="justify-start"
                onClick={() => move(null)}
              >
                Unassigned
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Selection.Provider>
  );
}
