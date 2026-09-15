import { useEffect, useId, useMemo, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { usePersistedFlag } from "../hooks/useViewState";
import { useScheduledTasks } from "../hooks/useScheduledTasks";
import { nextRunLabel, scheduleDescription, scheduleTime, visibleScheduledTasks, type ScheduledTask } from "../lib/scheduled-tasks";
import { cn } from "../lib/utils";
import { Icon } from "./ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ScheduledSection({ projectFilter }: { projectFilter?: string | null }) {
  const { value, refresh } = useScheduledTasks();
  const [expanded, setExpanded] = usePersistedFlag("bb-workspace-sidebar:scheduled-expanded:v1", false);
  const [now, setNow] = useState(Date.now);
  const sectionId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const entries = useMemo(() => visibleScheduledTasks(value?.entries ?? [], projectFilter), [value, projectFilter]);
  if (!value || value.availability === "unavailable" || (value.availability === "ready" && !entries.length)) return null;
  const attention = entries.filter(task => task.problem || task.lastRunStatus === "failed" || task.lastError).length;
  return <section className="ws-scheduled mt-2" aria-label="Scheduled tasks" data-sidebar-scheduled="">
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={expanded} aria-controls={sectionId} onClick={() => setExpanded(!expanded)}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" aria-hidden />
      <Icon name="Clock" className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium">Scheduled</span>
      <span className={cn("text-[11px] tabular-nums", attention > 0 && "ws-tone-attention")}>{value.availability === "error" ? "Unavailable" : attention ? `${attention} need attention` : entries.length}</span>
    </button>
    {expanded && <div id={sectionId} className="ws-scheduled-children ml-[14px] border-l border-border/60 pb-1 pl-2">
      {value.availability === "error" ? <div className="px-2 py-2 text-xs text-muted-foreground" role="status">Couldn’t load schedules. <button type="button" onClick={refresh} className="underline underline-offset-2">Retry</button></div>
        : entries.map(task => <ScheduledTaskRow key={task.id} task={task} now={now} />)}
    </div>}
  </section>;
}

function ScheduledTaskRow({ task, now }: { task: ScheduledTask; now: number }) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const failed = Boolean(task.problem || task.lastRunStatus === "failed" || task.lastError);
  const timezone = task.trigger?.triggerType === "schedule" ? task.trigger.timezone : undefined;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="ws-scheduled-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Schedule details: ${task.name}`}>
        <Icon name={task.trigger?.triggerType === "schedule" ? "Repeat" : "Clock"} className={cn("size-3.5 shrink-0", failed ? "ws-tone-danger" : "text-muted-foreground")} aria-hidden />
        <span className="min-w-0 flex-1"><span className="block truncate">{task.name}</span>
          <span className={cn("flex min-w-0 items-center gap-1.5 text-[11px]", !task.enabled ? "ws-tone-attention" : "text-muted-foreground")}>
            <span className="shrink-0 tabular-nums">{nextRunLabel(task, now)}</span>
            {failed && !task.problem && <span className="ws-tone-danger truncate">· Last run failed</span>}
            {!failed && <span className="truncate">· {scheduleDescription(task.trigger)}</span>}
          </span>
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="flex w-80 flex-col gap-3 p-3 text-xs" mobileTitle="Schedule details">
      <div><div className="font-medium text-foreground">{task.name}</div><div className="mt-1 text-muted-foreground">{task.projectName}</div></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">State</dt><dd>{task.problem ? "Needs attention" : !task.enabled ? "Paused" : "Enabled"}</dd>
        {task.trigger && <><dt className="text-muted-foreground">Schedule</dt><dd>{scheduleDescription(task.trigger)}</dd></>}
        {task.nextRunAt !== null && task.enabled && <><dt className="text-muted-foreground">Next run</dt><dd>{scheduleTime(task.nextRunAt, timezone)}</dd></>}
        {task.trigger?.triggerType === "once" && <><dt className="text-muted-foreground">Scheduled for</dt><dd>{scheduleTime(task.trigger.runAt)}</dd></>}
        <dt className="text-muted-foreground">Timezone</dt><dd className="break-words">{timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
        {task.lastRunStatus && <><dt className="text-muted-foreground">Last run</dt><dd className={cn(failed && "ws-tone-danger")}>{task.lastRunStatus}</dd></>}
      </dl>
      {task.lastError && <p className="ws-tone-danger break-words">{task.lastError}</p>}
      {task.problem && <p className="ws-tone-attention">This schedule needs to be repaired in Automations.</p>}
      {task.trigger?.triggerType === "schedule" && <details className="text-muted-foreground"><summary className="cursor-pointer">Schedule expression</summary><code className="mt-1 block font-mono">{task.trigger.cron}</code></details>}
      {task.threadId && <button type="button" onClick={() => { setOpen(false); navigate.toThread(task.threadId!); }} className="flex items-center gap-1.5 rounded border px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon name="MessageSquare" className="size-3.5" aria-hidden />Open related thread</button>}
    </PopoverContent>
  </Popover>;
}
