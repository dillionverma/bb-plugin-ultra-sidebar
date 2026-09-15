import { describe, expect, it } from "vitest";
import { summarizeQueue, scheduleLabel } from "./thread-queue";

describe("sidebar queue summaries", () => {
  it("keeps the earliest runnable schedule and failure independently", () => {
    expect(summarizeQueue([
      { threadId: "a", sendAt: 2000, failureReason: null, payload: { kind: "inline" } },
      { threadId: "a", sendAt: 1000, failureReason: "Failed", payload: { kind: "retry" } },
      { threadId: "b", sendAt: null, failureReason: null, payload: { kind: "inline" } },
    ])).toEqual([
      { threadId: "a", count: 2, sendAt: 2000, failed: true, retry: true },
      { threadId: "b", count: 1, sendAt: null, failed: false, retry: false },
    ]);
  });
  it("clears removed queue entries", () => expect(summarizeQueue([])).toEqual([]));
  it("never calls a due schedule running", () => expect(scheduleLabel(1000, 2000)).toBe("Scheduled · due"));
  it("uses calendar days for tomorrow", () => {
    expect(scheduleLabel(new Date(2026, 8, 16, 9).getTime(), new Date(2026, 8, 15, 23).getTime())).toMatch(/^Tomorrow · /);
  });
});
