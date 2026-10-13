import { Children, useState, type ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useThreadQueue } from "../hooks/useThreadQueue";
import { scheduleLabel, type QueueSummary } from "../lib/thread-queue";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type Mode = { key: string; label: string; detail: string; tone: string };
export function threadModes(thread: PluginSidebarThread, queue?: QueueSummary): Mode[] {
  const modes: Mode[] = [];
  if (thread.activity.planMode > 0 || thread.indicator === "plan-mode") {
    modes.push({ key: "plan", label: "Plan", detail: "Plan mode", tone: "text-muted-foreground" });
  }
  if (thread.activity.goals > 0 || thread.indicator === "goal") {
    modes.push({ key: "goal", label: "Goal", detail: "Active goal", tone: "ws-tone-goal" });
  }
  if (queue) {
    const label = queue.failed ? "Queue failed" : queue.retry ? "Retry queued"
      : queue.sendAt !== null ? scheduleLabel(queue.sendAt) : `${queue.count} queued`;
    const detail = `${queue.count} queued message${queue.count === 1 ? "" : "s"}`
      + (queue.sendAt !== null ? ` · Scheduled for ${new Date(queue.sendAt).toLocaleString()}` : "");
    modes.push({ key: "schedule", label, detail,
      tone: queue.failed ? "ws-tone-danger" : "text-muted-foreground" });
  }
  return modes;
}

export function ModeIcon({ kind }: { kind: string }) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" className="size-3 shrink-0">
    {kind === "goal" ? <><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.3"/><path d="M8 1v2M13 8h2M8 13v2M1 8h2"/></>
      : kind === "plan" ? <><path d="M5 4h8M5 8h8M5 12h5"/><path d="M2 4h.1M2 8h.1M2 12h.1" strokeWidth="2" strokeLinecap="round"/></>
      : <><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5" strokeLinecap="round"/></>}
  </svg>;
}

function ModeDetailsButton({ mode, threadTitle, compact, hideLabel, details, onOpenChange }: {
  mode: Mode;
  threadTitle: string;
  compact: boolean;
  hideLabel: boolean;
  details: ReactNode;
  onOpenChange?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  return <span className="inline-flex min-w-0 max-w-[45%]"
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onMouseDown={event => event.stopPropagation()}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onContextMenu={event => event.stopPropagation()}>
    <Popover open={open} onOpenChange={next => { setOpen(next); onOpenChange?.(next); }}>
      <PopoverTrigger asChild>
        <button type="button" title={mode.detail}
          aria-label={`${mode.detail}: details for ${threadTitle}`}
          className={cn("inline-flex min-w-0 items-center gap-1 rounded-sm text-[11px] leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mode.tone)}>
          <ModeIcon kind={mode.key} /><span className={compact && hideLabel ? "sr-only" : "truncate"}>{mode.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12}
        mobileTitle={mode.detail} className="w-auto max-w-[calc(100vw-1.5rem)] p-3">
        {details}
      </PopoverContent>
    </Popover>
  </span>;
}

export function ThreadModes({ thread, children, trailing, details, onDetailsOpenChange, compact = false }: {
  thread: PluginSidebarThread;
  children?: ReactNode;
  trailing?: ReactNode;
  details?: ReactNode;
  onDetailsOpenChange?(open: boolean): void;
  compact?: boolean;
}) {
  const queue = useThreadQueue(thread.id);
  const modes = threadModes(thread, queue);
  const hasChildren = Children.toArray(children).length > 0;
  if (!modes.length && !hasChildren && !trailing) return null;
  return <span className={cn("bb-ws-summary grid min-w-0 w-full grid-cols-[minmax(0,1fr)_fit-content(60%)] items-start gap-x-2 pl-[42px] text-[11px]", !compact && "pb-0.5")} data-thread-summary="">
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5" data-thread-modes="">
    {children}
    {modes.length > 0 && hasChildren ? <span aria-hidden className="shrink-0 text-muted-foreground/50">·</span> : null}
    {modes.map(mode => !details ? <span key={mode.key} title={mode.detail} aria-label={mode.detail} className={cn("inline-flex min-w-0 items-center gap-1 text-[11px] leading-5", mode.tone)}><ModeIcon kind={mode.key} /><span className="truncate">{mode.label}</span></span> : <ModeDetailsButton
      key={mode.key} mode={mode} threadTitle={thread.title ?? thread.titleFallback ?? "Untitled"}
      compact={compact} hideLabel={mode.key === "plan" && modes.some(other => other.key === "goal")}
      details={details} onOpenChange={onDetailsOpenChange}
    />)}
    </span>
    {trailing ? <span className="col-start-2 min-w-0 justify-self-end text-right" data-thread-diff-slot="">{trailing}</span> : null}
  </span>;
}
