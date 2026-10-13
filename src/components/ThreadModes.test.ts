import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadModes } from "./ThreadModes";
const thread = {
  indicator: "waiting-for-input",
  activity: { goals: 1, planMode: 1, workflows: 0, backgroundAgents: 0, backgroundCommands: 0 },
} as PluginSidebarThread;

describe("independent thread modes", () => {
  it("preserves goal and plan while input is needed and a message is scheduled", () => {
    expect(threadModes(thread, { threadId: "a", count: 1, sendAt: Date.now() + 60000, retry: false, failed: false }).map(x => x.key)).toEqual(["plan", "goal", "schedule"]);
  });
  it("keeps ordinary rows empty", () => {
    expect(threadModes({ ...thread, indicator: "none", activity: { ...thread.activity, goals: 0, planMode: 0 } })).toEqual([]);
  });
  it("reports failures ahead of future time", () => {
    expect(threadModes(thread, { threadId: "a", count: 1, sendAt: Date.now() + 60000, retry: true, failed: true }).at(-1)?.label).toBe("Queue failed");
  });
});
