import { describe, expect, it, vi } from "vitest";
import { createFakeSdk } from "@get-bb/plugin-sdk/testing";
import { createWorkflowAgentsReader } from "./workflow-agents.server";

describe("workflow agents reader", () => {
  it("uses workflow ownership, strips private fields, and coalesces reads", async () => {
    const callRpc = vi.fn(async ({ outputSchema }) => outputSchema.parse({ runs: [{
      id: "run", name: "Design", phases: [{ calls: [{
        id: "call", label: "Native glass", status: "running", childThreadId: "hidden-worker", model: "astra", provider: "codex", createdAt: 2,
        error: "private details", prompt: "private prompt",
      }] }], unphasedCalls: [], result: "private result",
    }] }));
    const { sdk } = createFakeSdk({ pluginId: "workspace-sidebar", overrides: { plugins: { callRpc } } });
    const read = createWorkflowAgentsReader(sdk.plugins);
    const [first, second] = await Promise.all([read(["origin", "origin"]), read(["origin"])]);
    expect(first).toEqual(second);
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc.mock.calls[0]![0]).toMatchObject({ pluginId: "workflows", method: "workflowActiveRuns", input: { threadId: "origin" } });
    expect(first.entries).toEqual([{ threadId: "origin", unavailable: false, runs: [{ id: "run", name: "Design", agents: [{
      id: "call", label: "Native glass", status: "running", childThreadId: "hidden-worker", model: "astra", provider: "codex", createdAt: 2,
    }] }] }]);
  });

  it("isolates unavailable workflow data from other origins", async () => {
    const { sdk } = createFakeSdk({ pluginId: "workspace-sidebar", overrides: { plugins: { callRpc: async ({ input }) => {
      if ((input as { threadId: string }).threadId === "bad") throw new Error("Unavailable");
      return { runs: [] } as never;
    } } } });
    const result = await createWorkflowAgentsReader(sdk.plugins)(["bad", "good"]);
    expect(result.entries).toEqual([
      { threadId: "bad", unavailable: true, runs: [] },
      { threadId: "good", unavailable: false, runs: [] },
    ]);
  });
});
