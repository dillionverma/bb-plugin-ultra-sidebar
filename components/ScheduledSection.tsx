import { useEffect, useId, useMemo, useState } from "react";
import { usePersistedFlag } from "../hooks/useViewState";
import { useScheduledTasks } from "../hooks/useScheduledTasks";
import { lastRunLabel, nextRunLabel, scheduleDescription, scheduleTime, visibleScheduledTasks, type ScheduledTask } from "../lib/scheduled-tasks";
import { cn } from "../lib/utils";
import { Icon } from "./ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "./ui/context-menu";
import { useSidebar } from "./sidebar-context";
import { DockAction, DockHeader, DockRow } from "./DockRow";
import { ProjectIcon } from "./ProjectIcon";
import { StatusIcon } from "./StatusIcon";
import { ThreadOrb } from "./ThreadOrb";
import { TONE_TEXT, type StatusTone } from "./ThreadStatus";

export function ScheduledSection({ projectIds }: { projectIds: readonly string[] | null }) {
  const { value, refresh, run, setEnabled, remove } = useScheduledTasks();
  const [expanded, setExpanded] = usePersistedFlag("bb-workspace-sidebar:scheduled-expanded:v1", false);
  const [now, setNow] = useState(Date.now);
  const sectionId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const entries = useMemo(() => visibleScheduledTasks(value?.entries ?? [], projectIds), [value, projectIds]);
  if (!value || value.availability === "unavailable" || (value.availability === "ready" && !entries.length)) return null;
  const attention = entries.filter(task => task.problem || task.lastRunStatus === "failed" || task.lastError).length;
  const running = entries.filter(task => task.lastRunStatus === "running").length;
  return <section className="ws-scheduled" aria-label="Scheduled tasks" data-sidebar-scheduled="">
    <DockHeader label="Scheduled" icon="Repeat" expanded={expanded} onToggle={() => setExpanded(!expanded)} controls={sectionId}
      count={value.availability === "error" ? "Unavailable" : attention ? `${attention} need attention` : running ? `${running} running` : entries.length}
      countTone={attention ? "ws-tone-danger" : running ? "ws-tone-working" : undefined} />
    {expanded && <div id={sectionId} className="bb-ws-section-tree max-h-48 overflow-y-auto pb-1">
      {value.availability === "error"
        ? <div className="px-3 py-1 text-xs text-muted-foreground/70" role="status">Couldn’t load schedules. <button type="button" onClick={refresh} className="underline underline-offset-2 hover:text-foreground">Retry</button></div>
        : <ul>{entries.map(task => <ScheduledTaskRow key={task.id} task={task} now={now} showProject={projectIds === null || projectIds.length !== 1} onRun={run} onSetEnabled={setEnabled} onDelete={remove} />)}</ul>}
    </div>}
  </section>;
}

/** One word about the schedule, ranked like a thread's status: trouble first, then motion, then the calendar. */
function scheduleStatus(task: ScheduledTask, now: number): { text: string; tone: StatusTone; detail: string } {
  if (task.problem) return { text: "Needs repair", tone: "needs-you", detail: "This schedule needs to be repaired in Automations" };
  if (task.lastRunStatus === "running") return { text: "Running", tone: "working", detail: "A run is in progress" };
  if (task.lastRunStatus === "failed" || task.lastError) return { text: lastRunLabel(task, now) ?? "Failed", tone: "problem", detail: task.lastError ?? "The last run failed" };
  if (!task.enabled) return { text: "Paused", tone: "idle", detail: "Paused: it will not run until resumed" };
  return { text: nextRunLabel(task, now), tone: "idle", detail: `Next run ${task.nextRunAt === null ? "not scheduled" : scheduleTime(task.nextRunAt)}` };
}

function ScheduledTaskRow({ task, now, showProject, onRun, onSetEnabled, onDelete }: {
  task: ScheduledTask; now: number; showProject: boolean;
  onRun(task: ScheduledTask): Promise<void>;
  onSetEnabled(task: ScheduledTask, enabled: boolean): Promise<void>;
  onDelete(task: ScheduledTask): Promise<void>;
}) {
  const sidebar = useSidebar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Delete is a two-step inside the details: the first press turns into a
  // question, so a slip cannot remove a schedule. Closing the details resets it.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const showDetails = (confirmDelete = false) => { setConfirmingDelete(confirmDelete); setOpen(true); };
  const setOpenAndReset = (next: boolean) => { setOpen(next); if (!next) setConfirmingDelete(false); };
  const status = scheduleStatus(task, now);
  const running = task.lastRunStatus === "running";
  const failed = status.tone === "problem";
  const timezone = task.trigger?.triggerType === "schedule" ? task.trigger.timezone : undefined;
  const active = task.threadId !== null && sidebar.activeThreadId === task.threadId;
  const canAct = task.problem === null && !busy;
  const act = async (work: Promise<void>) => {
    setBusy(true);
    try { await work; } finally { setBusy(false); }
  };
  // The row behaves like a thread row: click opens the thread that ran it.
  // Before a first run there is no thread, so the click shows the details.
  const openThread = () => {
    if (task.threadId === null) { showDetails(); return; }
    sidebar.openThread(task.threadId, false);
  };
  const glyph = running ? <ThreadOrb orb={{ state: "working", label: "A run is in progress" }} />
    : failed || task.problem ? <StatusIcon tone={status.tone} label={status.detail} className="size-3.5 shrink-0" />
    : <Icon name={task.trigger?.triggerType === "once" ? "Clock" : "Repeat"} aria-hidden className={cn("size-3.5 shrink-0", task.enabled ? "text-muted-foreground" : "text-muted-foreground/50")} />;
  const glyphTip = task.trigger?.triggerType === "once" ? "Runs once" : `${scheduleDescription(task.trigger)}${task.enabled ? "" : " · paused"}`;

  return <li>
    <Popover open={open} onOpenChange={setOpenAndReset}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <div className="relative flex items-start">
              <DockRow
                glyph={glyph} glyphTip={glyphTip} title={task.name} active={active} onOpen={openThread}
                ariaLabel={task.threadId === null ? `${task.name}: show schedule details` : `Open ${task.name}`}
                trailing={<>
                  <span className={cn("shrink-0 whitespace-nowrap tabular-nums", TONE_TEXT[status.tone], !task.enabled && !failed && "ws-tone-attention")} title={status.detail}>{status.text}</span>
                  {showProject && <span className="flex shrink-0 items-center text-muted-foreground" title={task.projectName}><ProjectIcon projectId={task.projectId} className="size-3" /></span>}
                </>}
                actions={<>
                  <DockAction label={running ? `${task.name} is running` : `Run ${task.name} now`} icon="Play" disabled={!canAct || running} onActivate={() => void act(onRun(task))} />
                  <DockAction label={task.enabled ? `Pause ${task.name}` : `Resume ${task.name}`} icon={task.enabled ? "Pause" : "RotateCcw"} disabled={!canAct} onActivate={() => void act(onSetEnabled(task, !task.enabled))} />
                  <DockAction label={`Schedule details: ${task.name}`} icon="Info" onActivate={() => showDetails()} />
                </>}
              />
            </div>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuGroup aria-label="Schedule">
            {task.threadId !== null && <ContextMenuItem onSelect={() => sidebar.openThread(task.threadId!, false)}><Icon name="MessageSquare" />Open last run</ContextMenuItem>}
            <ContextMenuItem disabled={!canAct || running} onSelect={() => void act(onRun(task))}><Icon name="Play" />Run now</ContextMenuItem>
            <ContextMenuItem disabled={!canAct} onSelect={() => void act(onSetEnabled(task, !task.enabled))}><Icon name={task.enabled ? "Pause" : "RotateCcw"} />{task.enabled ? "Pause" : "Resume"}</ContextMenuItem>
            <ContextMenuItem onSelect={() => showDetails()}><Icon name="Info" />Details</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem className="ws-tone-danger" onSelect={() => showDetails(true)}><Icon name="Trash2" />Delete…</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="flex w-80 flex-col gap-3 p-3 text-xs" mobileTitle="Schedule details">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex shrink-0 items-center">{glyph}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">{task.name}</div>
            <div className="mt-0.5 flex items-center gap-1 text-muted-foreground"><ProjectIcon projectId={task.projectId} className="size-3" /><span className="truncate">{task.projectName}</span></div>
          </div>
          <span className={cn("shrink-0 text-[11px]", TONE_TEXT[status.tone])}>{status.text}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {task.trigger && <><dt className="text-muted-foreground">Schedule</dt><dd>{scheduleDescription(task.trigger)}</dd></>}
          {task.nextRunAt !== null && task.enabled && <><dt className="text-muted-foreground">Next run</dt><dd>{scheduleTime(task.nextRunAt, timezone)}</dd></>}
          {task.trigger?.triggerType === "once" && <><dt className="text-muted-foreground">Scheduled for</dt><dd>{scheduleTime(task.trigger.runAt)}</dd></>}
          <dt className="text-muted-foreground">Timezone</dt><dd className="break-words">{timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
          {task.lastRunStatus && <><dt className="text-muted-foreground">Last run</dt><dd className={cn(failed && "ws-tone-danger")}>{task.lastRunStatus}{task.lastRunAt !== null && ` · ${scheduleTime(task.lastRunAt)}`}</dd></>}
        </dl>
        {task.lastError && <p className="ws-tone-danger break-words">{task.lastError}</p>}
        {task.problem && <p className="ws-tone-attention">This schedule needs to be repaired in Automations.</p>}
        {task.trigger?.triggerType === "schedule" && <details className="text-muted-foreground"><summary className="cursor-pointer">Schedule expression</summary><code className="mt-1 block font-mono">{task.trigger.cron}</code></details>}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={!canAct || running} onClick={() => void act(onRun(task))}
            className="flex items-center gap-1.5 rounded border px-2 py-1.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon name="Play" className="size-3.5" aria-hidden />{running ? "Running" : "Run now"}</button>
          <button type="button" disabled={!canAct} onClick={() => void act(onSetEnabled(task, !task.enabled))}
            className="flex items-center gap-1.5 rounded border px-2 py-1.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon name={task.enabled ? "Pause" : "RotateCcw"} className="size-3.5" aria-hidden />{task.enabled ? "Pause" : "Resume"}</button>
          {task.threadId && <button type="button" onClick={() => { setOpenAndReset(false); sidebar.openThread(task.threadId!, false); }} className="flex items-center gap-1.5 rounded border px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon name="MessageSquare" className="size-3.5" aria-hidden />Open last run</button>}
        </div>
        {confirmingDelete
          ? <div className="flex flex-wrap items-center gap-1.5 rounded border border-destructive/40 p-2" role="group" aria-label="Confirm deletion">
              <span className="min-w-0 flex-1">Delete this schedule for good? Its past runs stay in their threads.</span>
              <button type="button" disabled={busy} onClick={() => void act(onDelete(task).then(() => setOpenAndReset(false)))}
                className="rounded bg-destructive px-2 py-1 font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Delete schedule</button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded border px-2 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Keep</button>
            </div>
          : <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}
              className="ws-tone-danger flex w-fit items-center gap-1.5 rounded px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon name="Trash2" className="size-3.5" aria-hidden />Delete…</button>}
      </PopoverContent>
    </Popover>
  </li>;
}
