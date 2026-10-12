import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

async function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "workspace-sidebar",
    sdk: { threads: { events: { list: async () => [] } } },
  });
  await plugin(bb);
  return harness;
}

describe("resuming backlog threads", () => {
  it.each(["thread.active", "message.queued"] as const)("persists clearing backlog on %s", async event => {
    const harness = await setup();
    try {
      await harness.behavior.callRpc("lifecycle.setStatus", { threadIds: ["t1"], status: "backlog" });
      if (event === "thread.active") {
        await harness.behavior.emitThreadEvent(event, { thread: makeThreadResponse({ id: "t1" }) });
      } else {
        await harness.behavior.emitThreadEvent(event, { entry: makeQueueEntry({ threadId: "t1", initiator: "user" }) });
      }
      const state = await harness.behavior.callRpc("sidebar.state", null);
      expect(state.lifecycle).toContainEqual({ threadId: "t1", status: null, snoozedUntil: null });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it.each(["done", "canceled"] as const)("preserves explicit %s when an agent starts", async status => {
    const harness = await setup();
    try {
      await harness.behavior.callRpc("lifecycle.setStatus", { threadIds: ["t1"], status });
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "t1" }) });
      const state = await harness.behavior.callRpc("sidebar.state", null);
      expect(state.lifecycle).toContainEqual({ threadId: "t1", status, snoozedUntil: null });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("does not resume backlog for a queued agent message until it starts", async () => {
    const harness = await setup();
    try {
      await harness.behavior.callRpc("lifecycle.setStatus", { threadIds: ["t1"], status: "backlog" });
      await harness.behavior.emitThreadEvent("message.queued", { entry: makeQueueEntry({ threadId: "t1", initiator: "agent" }) });
      expect((await harness.behavior.callRpc("sidebar.state", null)).lifecycle).toContainEqual({ threadId: "t1", status: "backlog", snoozedUntil: null });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
