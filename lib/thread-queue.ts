export interface QueueSummary {
  threadId: string;
  count: number;
  sendAt: number | null;
  retry: boolean;
  failed: boolean;
}

interface QueueRow {
  threadId: string;
  sendAt: number | null;
  failureReason: string | null;
  payload: { kind: string };
}

export function summarizeQueue(rows: readonly QueueRow[]): QueueSummary[] {
  const summaries = new Map<string, QueueSummary>();
  for (const row of rows) {
    const summary = summaries.get(row.threadId) ?? {
      threadId: row.threadId, count: 0, sendAt: null, retry: false, failed: false,
    };
    summary.count++;
    summary.failed ||= row.failureReason !== null;
    summary.retry ||= row.payload.kind === "retry";
    if (row.failureReason === null && row.sendAt !== null && Number.isFinite(row.sendAt)) {
      summary.sendAt = summary.sendAt === null ? row.sendAt : Math.min(summary.sendAt, row.sendAt);
    }
    summaries.set(row.threadId, summary);
  }
  return [...summaries.values()];
}

export function scheduleLabel(sendAt: number, now = Date.now()): string {
  if (sendAt <= now) return "Scheduled · due";
  const date = new Date(sendAt);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = date.toDateString() === today.toDateString() ? "Today"
    : date.toDateString() === tomorrow.toDateString() ? "Tomorrow"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
