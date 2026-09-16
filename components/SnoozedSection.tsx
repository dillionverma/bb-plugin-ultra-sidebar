import { useId } from "react";
import type { SnoozedEntry } from "../lib/resolve";
import { scheduleLabel } from "../lib/thread-queue";
import { usePersistedFlag } from "../hooks/useViewState";
import { Icon } from "./ui/icon";
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger,
} from "./ui/context-menu";
import { useSidebar } from "./sidebar-context";
import { DockAction, DockHeader, DockRow } from "./DockRow";
import { ProjectIcon } from "./ProjectIcon";
import { StatusIcon } from "./StatusIcon";

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
    <DockHeader label="Snoozed" icon="Clock" count={entries.length} expanded={expanded} onToggle={() => setExpanded(!expanded)} controls={sectionId}
      trailing={expanded && entries.length > 1
        ? <button type="button" aria-label="Wake all snoozed threads"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100 pointer-coarse:opacity-100"
            onClick={() => entries.forEach(entry => sidebar.setSnoozed(entry.thread.id, null))}>Wake all</button>
        : undefined} />
    {expanded && <ul id={sectionId} className="bb-ws-section-tree max-h-48 overflow-y-auto pb-1">
      {entries.map(entry => <SnoozedRow key={entry.thread.id} entry={entry} now={now} />)}
    </ul>}
  </section>;
}

function SnoozedRow({ entry, now }: { entry: SnoozedEntry; now: number }) {
  const sidebar = useSidebar();
  const { thread, until } = entry;
  const title = thread.title ?? thread.titleFallback ?? thread.id;
  const project = sidebar.projectNameOf(thread.projectId);
  const wake = scheduleLabel(until, now).replace("Scheduled · ", "");
  return <li>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative flex items-start">
          <DockRow
            glyph={<StatusIcon tone="idle" label={`Snoozed until ${wake}`} className="size-3.5 shrink-0" />}
            glyphTip={`Snoozed · back ${wake}`}
            title={title}
            active={sidebar.activeThreadId === thread.id}
            ariaLabel={`Open ${title}`}
            onOpen={() => sidebar.openThread(thread.id, false)}
            trailing={<>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground" title={`Wakes ${wake}`}>{wake}</span>
              {project !== "" && <span className="flex shrink-0 items-center text-muted-foreground" title={project}><ProjectIcon projectId={thread.projectId} className="size-3" /></span>}
            </>}
            actions={<DockAction label={`Wake ${title}`} icon="RotateCcw" text="Wake" onActivate={() => sidebar.setSnoozed(thread.id, null)} />}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuGroup aria-label="Snoozed thread">
          <ContextMenuItem onSelect={() => sidebar.openThread(thread.id, false)}><Icon name="MessageSquare" />Open</ContextMenuItem>
          <ContextMenuItem onSelect={() => sidebar.setSnoozed(thread.id, null)}><Icon name="RotateCcw" />Wake now</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  </li>;
}
