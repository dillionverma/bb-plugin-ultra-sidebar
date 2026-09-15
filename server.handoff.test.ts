import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

describe("sidebar handoff RPC", () => {
  it("uses the handoff plugin and preserves an explicit unassigned workspace", async () => {
    const callRpc = vi.fn(async () => ({ threadId: "next" }));
    const { bb, harness } = createFakePluginHost({ pluginId: "workspace-sidebar", sdk: { plugins: { callRpc } } });
    try {
      await plugin(bb);
      expect(await harness.behavior.callRpc("threads.handoff", { threadId: "source", workspaceId: null, target: { providerId: "codex", model: "gpt-6" } })).toEqual({ threadId: "next" });
      expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "handoff", method: "handoff", input: { threadId: "source", target: { providerId: "codex", model: "gpt-6" } } }));
      const state = await harness.behavior.callRpc("workspaces.state", null);
      expect(state).toMatchObject({ assignments: [expect.objectContaining({ kind: "thread", refId: "next", workspaceId: null })] });
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
