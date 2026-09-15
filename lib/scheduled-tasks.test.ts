import { afterEach, expect, it, vi } from "vitest";
import { nextRunLabel, scheduleDescription, scheduleTime, visibleScheduledTasks, type ScheduledTask } from "./scheduled-tasks";
import { createScheduledTasksReader } from "./scheduled-tasks.server";

const now = Date.UTC(2026, 8, 15, 12);
const task = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "one", projectId: "p1", projectName: "BB", name: "Review", enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "America/Toronto" },
  nextRunAt: now + 3_600_000, lastRunStatus: null, lastError: null, threadId: null, problem: null,
  ...overrides,
});
afterEach(() => vi.useRealTimers());

it("sorts upcoming work before paused items and filters projects", () => {
  const entries = [task({ id: "paused", enabled: false, nextRunAt: now }), task({ id: "later", nextRunAt: now + 100 }),
    task({ id: "first", nextRunAt: now }), task({ id: "other", projectId: "p2" })];
  expect(visibleScheduledTasks(entries, "p1").map(item => item.id)).toEqual(["first", "later", "paused"]);
});

it("retains failed and invalid schedules but removes completed one-offs", () => {
  const once = task({ trigger: { triggerType: "once", runAt: now }, enabled: false, nextRunAt: null });
  const entries = [task({ ...once, id: "done", lastRunStatus: "succeeded" }),
    task({ ...once, id: "failed", lastRunStatus: "failed" }), task({ id: "invalid", problem: "invalid-stored-data" })];
  expect(visibleScheduledTasks(entries).map(item => item.id).sort()).toEqual(["failed", "invalid"]);
});

it("never treats a due timestamp as proof of running and avoids zero-minute labels", () => {
  expect(nextRunLabel(task({ nextRunAt: now }), now)).toBe("Due");
  expect(nextRunLabel(task({ nextRunAt: now + 1 }), now)).toBe("In 1m");
  expect(nextRunLabel(task({ nextRunAt: now + 59 * 60_000 }), now)).toBe("In 59m");
  expect(nextRunLabel(task({ nextRunAt: now + 60 * 60_000 }), now)).toMatch(/^Today · .*\d:\d{2}/);
  expect(nextRunLabel(task({ enabled: false, lastRunStatus: "running" }), now)).toBe("Paused");
  expect(nextRunLabel(task({ nextRunAt: null, lastRunStatus: "running" }), now)).toBe("Running");
});

it("formats a schedule in its own timezone and tolerates invalid old timezone values", () => {
  expect(scheduleTime(now, "America/Toronto")).toContain("8:00");
  expect(scheduleTime(now, "UTC")).toContain("12:00");
  expect(() => scheduleTime(now, "invalid/timezone")).not.toThrow();
});

it("names common schedules and keeps unsupported expressions honest", () => {
  const describe = (cron: string) => scheduleDescription({ triggerType: "schedule", cron, timezone: "UTC" });
  expect(describe("0 9 * * *")).toBe("Daily");
  expect(describe("0 9 * * 1-5")).toBe("Weekdays");
  expect(describe("0 9 * * 1")).toBe("Weekly");
  expect(describe("15 * * * *")).toBe("Every hour");
  expect(describe("*/15 * * * *")).toBe("Every 15 minutes");
  expect(describe("0 9 1 * *")).toBe("Custom recurring schedule");
});

function mockPlugins(data: unknown) {
  const callRpc = vi.fn(async (args: { outputSchema: { parse(input: unknown): unknown } }) => args.outputSchema.parse(data));
  const list = vi.fn(async () => ({ plugins: [] as { id: string; enabled: boolean }[] }));
  const api = { callRpc, list } as unknown as Parameters<typeof createScheduledTasksReader>[0];
  return { api, callRpc, list };
}

it("uses the public automations RPC and strips prompts from the sidebar response", async () => {
  const { api, callRpc } = mockPlugins({ automations: [{ project: { id: "p1", name: "BB" }, automation: {
    ...task(), execution: { targetThreadId: "thread-1", prompt: "private instructions", script: "private script" },
  } }] });
  const read = createScheduledTasksReader(api);
  const result = await read();
  expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "automations", method: "automations_overview", input: null }));
  expect(result).toEqual({ availability: "ready", entries: [task({ threadId: "thread-1" })] });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("deduplicates concurrent reads, expires cache and clears stale schedules on errors", async () => {
  vi.useFakeTimers();
  const { api, callRpc, list } = mockPlugins({ automations: [{ project: { id: "p1", name: "BB" }, automation: task() }] });
  const read = createScheduledTasksReader(api);
  const [first, second] = await Promise.all([read(), read()]);
  expect(first).toEqual(second);
  expect(callRpc).toHaveBeenCalledTimes(1);
  await read();
  expect(callRpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_001);
  callRpc.mockRejectedValue(new Error("offline"));
  list.mockResolvedValue({ plugins: [{ id: "automations", enabled: true }] });
  expect(await read()).toEqual({ availability: "error", entries: [] });
});

it("hides missing or disabled automations without failing the sidebar", async () => {
  const { api, callRpc, list } = mockPlugins(null);
  callRpc.mockRejectedValue(new Error("not installed"));
  expect(await createScheduledTasksReader(api)()).toEqual({ availability: "unavailable", entries: [] });
  list.mockResolvedValue({ plugins: [{ id: "automations", enabled: false }] });
  expect(await createScheduledTasksReader(api)()).toEqual({ availability: "unavailable", entries: [] });
});
