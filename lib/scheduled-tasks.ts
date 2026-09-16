import { scheduleLabel } from "./thread-queue";

export interface ScheduledTask {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  enabled: boolean;
  trigger: { triggerType: "schedule"; cron: string; timezone: string } | { triggerType: "once"; runAt: number } | null;
  nextRunAt: number | null;
  lastRunStatus: string | null;
  lastRunAt: number | null;
  lastError: string | null;
  threadId: string | null;
  problem: string | null;
}

export interface ScheduledTasksResult {
  availability: "ready" | "unavailable" | "error";
  entries: ScheduledTask[];
}

/** Paused and invalid schedules stay inspectable; completed one-offs leave the upcoming list. */
export function visibleScheduledTasks(entries: readonly ScheduledTask[], projectIds: readonly string[] | null = null): ScheduledTask[] {
  return entries.filter(task => (projectIds === null || projectIds.includes(task.projectId))
    && !(task.trigger?.triggerType === "once" && task.lastRunStatus === "succeeded" && task.nextRunAt === null))
    .sort((a, b) => {
      const aTime = a.enabled ? a.nextRunAt : null;
      const bTime = b.enabled ? b.nextRunAt : null;
      return (aTime ?? Infinity) - (bTime ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

export function nextRunLabel(task: ScheduledTask, now: number): string {
  if (task.problem) return "Needs attention";
  if (!task.enabled) return "Paused";
  if (task.nextRunAt === null) return task.lastRunStatus === "running" ? "Running" : "No next run";
  if (task.nextRunAt <= now) return "Due";
  const minutes = Math.ceil((task.nextRunAt - now) / 60_000);
  if (minutes < 60) return `In ${minutes}m`;
  return scheduleLabel(task.nextRunAt, now);
}

/**
 * What the last run did, in the row's second line: "Ran 2h ago", "Failed
 * 2h ago", "Running". Null when it has never run, so the schedule's shape
 * ("Daily") can take the slot instead.
 */
export function lastRunLabel(task: ScheduledTask, now: number): string | null {
  if (task.lastRunStatus === "running") return "Running";
  if (task.lastRunAt === null) return task.lastRunStatus === "failed" ? "Last run failed" : null;
  const ago = relativeAgo(task.lastRunAt, now);
  if (task.lastRunStatus === "failed") return `Failed ${ago}`;
  if (task.lastRunStatus === "skipped") return `Skipped ${ago}`;
  return `Ran ${ago}`;
}

function relativeAgo(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function scheduleTime(timestamp: number, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}),
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

/** Recognize the common cron shapes without claiming to interpret arbitrary cron syntax. */
export function scheduleDescription(trigger: ScheduledTask["trigger"]): string {
  if (trigger?.triggerType === "once") return "One time";
  if (!trigger) return "Schedule unavailable";
  const [minute, hour, day, month, weekday, ...extra] = trigger.cron.trim().split(/\s+/);
  if (extra.length || month !== "*" || day !== "*") return "Custom recurring schedule";
  if (/^\d+$/.test(minute ?? "") && hour === "*" && weekday === "*") return "Every hour";
  if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "")) {
    if (weekday === "*") return "Daily";
    if (weekday === "1-5" || weekday === "MON-FRI") return "Weekdays";
    if (/^[0-7]$/.test(weekday ?? "") || /^(SUN|MON|TUE|WED|THU|FRI|SAT)$/.test(weekday ?? "")) return "Weekly";
  }
  const interval = /^\*\/(\d+)$/.exec(minute ?? "");
  if (interval && hour === "*" && weekday === "*") return interval[1] === "1" ? "Every minute" : `Every ${interval[1]} minutes`;
  return "Custom recurring schedule";
}
