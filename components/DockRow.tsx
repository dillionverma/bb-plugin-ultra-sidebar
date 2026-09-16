// The dock's rows and headers, cut to the thread list's pattern so the bottom
// of the sidebar reads as one list rather than a second widget: the same
// chevron slot, glyph column, title, trailing word and hover actions.
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function DockHeader({ label, icon, count, countTone, expanded, onToggle, controls, trailing }: {
  label: string;
  icon: IconName;
  count: ReactNode;
  countTone?: string;
  expanded: boolean;
  onToggle(): void;
  controls: string;
  trailing?: ReactNode;
}) {
  return <div className={cn("group/header flex items-center gap-1 rounded-md px-1 py-1 transition-colors", expanded && "text-foreground")}>
    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon name="ChevronRight" className={cn("size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150", expanded && "rotate-90")} aria-hidden />
      <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover/header:text-foreground">{label}</span>
      <span className={cn("shrink-0 text-[11px] leading-4 tabular-nums", countTone ?? "text-muted-foreground")}>{count}</span>
    </button>
    {trailing}
  </div>;
}

export function DockRow({ glyph, glyphTip, title, trailing, actions, active, ariaLabel, onOpen, onContextMenu, testId }: {
  glyph: ReactNode;
  glyphTip: string;
  title: string;
  /** One word about the row, in its tone: the next run, the wake time. */
  trailing?: ReactNode;
  /** Hover-only actions; they overlay the trailing word like a thread row's. */
  actions?: ReactNode;
  active?: boolean;
  ariaLabel: string;
  onOpen(): void;
  onContextMenu?(event: MouseEvent<HTMLElement>): void;
  testId?: string;
}) {
  return <a href="#" draggable={false} aria-label={ariaLabel} aria-current={active ? "page" : undefined}
    data-dock-row={testId}
    onClick={event => { event.preventDefault(); onOpen(); }}
    onContextMenu={onContextMenu}
    className={cn(
      "bb-ws-row bb-ws-dock-row group/row flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-[6px] pr-2 text-sm transition-colors",
      "min-h-6 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      active && "bg-accent text-foreground",
    )}>
    <span aria-hidden className="w-4 shrink-0" />
    <RowTip label={glyphTip}><span className="flex shrink-0 items-center">{glyph}</span></RowTip>
    <span className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <span className={cn("bb-ws-title min-w-0 flex-1 truncate", active ? "font-medium text-foreground" : "text-foreground/90")}>{title}</span>
      {trailing !== undefined && <span className="bb-ws-dock-trailing flex shrink-0 items-center gap-1.5 text-xs">{trailing}</span>}
      {actions !== undefined && <span className={cn(
        "bb-ws-dock-actions absolute right-0 flex items-center gap-0.5 rounded bg-accent pl-1 opacity-0 transition-opacity",
        "pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
      )}>{actions}</span>}
    </span>
  </a>;
}

/** A hover action in the trailing slot; stops every event that would open the row. */
export function DockAction({ label, icon, text, tone, disabled, onActivate }: {
  label: string;
  icon: IconName;
  text?: string;
  tone?: string;
  disabled?: boolean;
  onActivate(): void;
}) {
  return <RowTip label={label}>
    <button type="button" aria-label={label} disabled={disabled}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onActivate(); }}
      className={cn("bb-ws-row-action flex h-5 shrink-0 items-center gap-1 rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        text === undefined ? "px-0.5" : "px-1", tone)}>
      <Icon name={icon} aria-hidden className="size-3.5" />
      {text === undefined ? null : <span className="text-[11px] font-medium">{text}</span>}
    </button>
  </RowTip>;
}

export function RowTip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
  </Tooltip>;
}
