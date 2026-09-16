import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

describe("sidebar handoff RPC", () => {
  it("delegates to the handoff plugin and files nothing of its own", async () => {
    const callRpc = vi.fn(async () => ({ threadId: "next" }));
    const { bb, harness } = createFakePluginHost({ pluginId: "workspace-sidebar", sdk: { plugins: { callRpc } } });
    try {
      await plugin(bb);
      expect(await harness.behavior.callRpc("threads.handoff", { threadId: "source", target: { providerId: "codex", model: "gpt-6" } })).toEqual({ threadId: "next" });
      expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "handoff", method: "handoff", input: { threadId: "source", target: { providerId: "codex", model: "gpt-6" } } }));
      // The successor sorts by recency like any new thread: giving it a
      // hand-picked position nobody asked for would bury it.
      expect(await harness.behavior.callRpc("sidebar.state", null)).toMatchObject({ order: [] });
    } finally { await harness.lifecycle.dispose(); }
  });
  it("routes model discovery to the source environment", async () => {
    const models = vi.fn(async () => ({ models: [], modelLoadError: { code: "auth_required" } }));
    const list = vi.fn(async () => []);
    const { bb, harness } = createFakePluginHost({ pluginId: "workspace-sidebar", sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: "env_source", providerId: "codex" }) },
      providers: { list, models },
    } });
    try {
      await plugin(bb);
      expect(await harness.behavior.callRpc("threads.handoffOptions", { threadId: "source", providerId: "claude-code" })).toMatchObject({ providerId: "claude-code", error: "Models unavailable: auth_required" });
      expect(models).toHaveBeenCalledWith({ environmentId: "env_source", providerId: "claude-code" });
      expect(list).toHaveBeenCalledWith({ environmentId: "env_source" });
    } finally { await harness.lifecycle.dispose(); }
  });
});
