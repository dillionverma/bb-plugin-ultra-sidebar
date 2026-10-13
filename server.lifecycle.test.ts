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

/** File t1 by hand through the CLI, the surface that owns manual status. */
async function file(harness: Awaited<ReturnType<typeof setup>>, status: "backlog" | "done" | "canceled") {
  expect(await harness.behavior.runCli(["status", status, "--thread", "t1"])).toMatchObject({ exitCode: 0 });
}

describe("resuming backlog threads", () => {
  it.each(["thread.active", "message.queued"] as const)("persists clearing backlog on %s", async event => {
    const harness = await setup();
    try {
      await file(harness, "backlog");
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
      await file(harness, status);
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
      await file(harness, "backlog");
      await harness.behavior.emitThreadEvent("message.queued", { entry: makeQueueEntry({ threadId: "t1", initiator: "agent" }) });
      expect((await harness.behavior.callRpc("sidebar.state", null)).lifecycle).toContainEqual({ threadId: "t1", status: "backlog", snoozedUntil: null });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
});
