import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";

type Timeline = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>>;

describe("threads.plan RPC", () => {
  it.each([
    { mode: "plan" as const, prompt: "Inspect the sidebar", providerId: "codex" },
    null,
  ])("reads current plan mode without downloading conversation rows", async plan => {
    const timeline = vi.fn(async () => ({ activePromptMode: plan, rows: [{ privateHistory: "not returned" }] }) as unknown as Timeline);
    const { bb, harness } = createFakePluginHost({
      pluginId: "workspace-sidebar",
      sdk: { threads: { timeline } },
    });
    try {
      await plugin(bb);
      expect(await harness.behavior.callRpc("threads.plan", { threadId: "t1" })).toEqual({ plan });
      expect(timeline).toHaveBeenCalledExactlyOnceWith({ threadId: "t1", segmentLimit: "1", summaryOnly: "true" });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("rejects an empty thread id before reading the host", async () => {
    const timeline = vi.fn();
    const { bb, harness } = createFakePluginHost({ pluginId: "workspace-sidebar", sdk: { threads: { timeline } } });
    try {
      await plugin(bb);
      await expect(harness.behavior.callRpc("threads.plan", { threadId: "" })).rejects.toThrow();
      expect(timeline).not.toHaveBeenCalled();
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
