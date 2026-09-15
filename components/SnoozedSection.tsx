import { useId } from "react";
import type { SnoozedEntry } from "../lib/resolve";
import { scheduleLabel } from "../lib/thread-queue";
import { usePersistedFlag } from "../hooks/useViewState";
import { cn } from "../lib/utils";
import { Icon } from "./ui/icon";
import { useSidebar } from "./sidebar-context";

export const SNOOZED_EXPANDED_KEY = "bb-workspace-sidebar:snoozed-expanded:v1";

/**
 * The threads a person has parked until later. They leave the list, but not
 * the sidebar: a hidden thread with no way back is a lost thread. Each row
 * says when it returns and offers to bring it back now.
 */
export function SnoozedSection({ entries, now }: { entries: readonly SnoozedEntry[]; now: number }) {
  const sidebar = useSidebar();
  const [expanded, setExpanded] = usePersistedFlag(SNOOZED_EXPANDED_KEY, true);
  const sectionId = useId();
  if (entries.length === 0) return null;
  return <section className="ws-snoozed" aria-label="Snoozed threads" data-sidebar-snoozed="">
    <div className="flex items-center gap-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded} aria-controls={sectionId} onClick={() => setExpanded(!expanded)}>
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" aria-hidden />
        <Icon name="Clock" className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">Snoozed</span>
        <span className="text-[11px] tabular-nums">{entries.length}</span>
      </button>
      {expanded && entries.length > 1 && <button type="button" aria-label="Wake all snoozed threads"
        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => entries.forEach(entry => sidebar.setSnoozed(entry.thread.id, null))}>Wake all</button>}
    </div>
    {expanded && <ul id={sectionId} className="ws-snoozed-children ml-[14px] max-h-48 overflow-y-auto border-l border-border/60 pb-1 pl-2">
      {entries.map(entry => <SnoozedRow key={entry.thread.id} entry={entry} now={now} />)}
    </ul>}
  </section>;
}

function SnoozedRow({ entry, now }: { entry: SnoozedEntry; now: number }) {
  const sidebar = useSidebar();
  const { thread, until } = entry;
  const title = thread.title ?? thread.titleFallback ?? thread.id;
  const project = sidebar.projectNameOf(thread.projectId);
  const active = sidebar.activeThreadId === thread.id;
  return <li className="group/snoozed flex items-center gap-1">
    <button type="button" onClick={() => sidebar.openThread(thread.id, false)}
      className={cn("ws-snoozed-row flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "bg-accent")}>
      <Icon name="Clock" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0 tabular-nums">Until {scheduleLabel(until, now).replace("Scheduled · ", "")}</span>
          {project !== "" && <span className="truncate">· {project}</span>}
        </span>
      </span>
    </button>
    <button type="button" aria-label={`Wake ${title}`} title="Bring this thread back now"
      className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => sidebar.setSnoozed(thread.id, null)}>Wake</button>
  </li>;
}
