import { describe, expect, it } from "vitest";
import {
  applyAgentEvent,
  applyAgentEvents,
  commandProgram,
  describeItem,
  initialAgentActivityState,
  type AgentEvent,
} from "./agent-activity";

let seq = 0;
function ev(type: string, item?: Record<string, unknown>, extra?: Record<string, unknown>): AgentEvent {
  seq += 1;
  return {
    type,
    seq,
    createdAt: 1_000 + seq,
    data: item === undefined ? extra : { item, ...extra },
  };
}

describe("commandProgram", () => {
  it("names the program, not the path or the cd in front of it", () => {
    expect(commandProgram("cd /tmp/x && npm test")).toBe("npm");
    expect(commandProgram("/usr/bin/env python3 -c 'print(1)'")).toBe("env");
    expect(commandProgram("FOO=1 BAR=2 grep -rn foo .")).toBe("grep");
    expect(commandProgram("sudo rm -rf ./dist")).toBe("rm");
    expect(commandProgram("bb thread list | head")).toBe("bb");
    expect(commandProgram("   ")).toBeNull();
  });
});

describe("describeItem", () => {
  it("gives each item kind a short verb and a full detail", () => {
    const at = 1;
    expect(describeItem({ type: "reasoning", id: "r" }, 1, at)?.activity.label).toBe("Thinking");
    expect(
      describeItem({ type: "commandExecution", id: "c", command: "cd a && npx vitest run" }, 1, at)
        ?.activity,
    ).toMatchObject({ kind: "command", label: "Running npx", detail: "cd a && npx vitest run" });
    expect(
      describeItem(
        { type: "fileChange", id: "f", changes: [{ path: "/x/components/ThreadRow.tsx", kind: "update" }, { path: "/x/b.ts", kind: "add" }] },
        1,
        at,
      )?.activity,
    ).toMatchObject({ kind: "editing", label: "Editing ThreadRow.tsx +1" });
    expect(describeItem({ type: "fileRead", id: "f", path: "/a/b/c.md" }, 1, at)?.activity.label).toBe("Reading c.md");
    expect(describeItem({ type: "search", id: "s", mode: "content", query: "foo" }, 1, at)?.activity).toMatchObject({ label: "Searching code", detail: "foo" });
    expect(describeItem({ type: "search", id: "s", mode: "path", query: "*.ts" }, 1, at)?.activity.label).toBe("Finding files");
    expect(describeItem({ type: "webSearch", id: "w", queries: ["a", "b"] }, 1, at)?.activity).toMatchObject({ label: "Searching the web", detail: "a · b" });
    expect(describeItem({ type: "webFetch", id: "w", url: "https://www.example.com/x" }, 1, at)?.activity.label).toBe("Fetching example.com");
    expect(describeItem({ type: "toolCall", id: "t", tool: "get_video", server: "cops" }, 1, at)?.activity).toMatchObject({ label: "Calling get_video", detail: "Calling get_video on cops" });
    expect(describeItem({ type: "delegation", id: "d", label: "Explore" }, 1, at)?.activity).toMatchObject({ label: "Delegating", detail: "Explore" });
    expect(describeItem({ type: "backgroundTask", id: "b", description: "Install deps" }, 1, at)).toMatchObject({ background: true, activity: { label: "Background task", detail: "Install deps" } });
    expect(describeItem({ type: "agentMessage", id: "m" }, 1, at)?.activity.label).toBe("Writing");
  });

  it("ignores the user's own messages and shrugs at unknown kinds", () => {
    expect(describeItem({ type: "userMessage", id: "u" }, 1, 1)).toBeNull();
    expect(describeItem({ type: "someFutureKind", id: "z" }, 1, 1)?.activity.label).toBe("Working");
    expect(describeItem({ id: "no-type" }, 1, 1)).toBeNull();
  });

  it("clips a long command to one line", () => {
    const command = `echo ${"x".repeat(400)}\n\nmore`;
    const detail = describeItem({ type: "commandExecution", id: "c", command }, 1, 1)?.activity.detail ?? "";
    expect(detail.length).toBeLessThanOrEqual(160);
    expect(detail).not.toContain("\n");
  });
});

describe("applyAgentEvent", () => {
  it("follows the newest open item and falls back to thinking between items", () => {
    const state = initialAgentActivityState();
    expect(applyAgentEvent(state, ev("turn/started"))).toBe(true);
    expect(state.current?.label).toBe("Starting");

    applyAgentEvent(state, ev("item/started", { type: "reasoning", id: "r1" }));
    expect(state.current?.label).toBe("Thinking");

    applyAgentEvent(state, ev("item/completed", { type: "reasoning", id: "r1" }));
    applyAgentEvent(state, ev("item/started", { type: "commandExecution", id: "c1", command: "git status" }));
    expect(state.current?.label).toBe("Running git");

    applyAgentEvent(state, ev("item/completed", { type: "commandExecution", id: "c1" }));
    expect(state.current?.kind).toBe("thinking");

    expect(applyAgentEvent(state, ev("turn/completed"))).toBe(true);
    expect(state.current).toBeNull();
  });

  it("prefers a foreground item over a lingering background task", () => {
    const state = initialAgentActivityState();
    applyAgentEvent(state, ev("turn/started"));
    applyAgentEvent(state, ev("item/started", { type: "backgroundTask", id: "b1", description: "Wait for CI" }));
    expect(state.current?.label).toBe("Background task");
    applyAgentEvent(state, ev("item/started", { type: "fileRead", id: "f1", path: "/a.ts" }));
    expect(state.current?.label).toBe("Reading a.ts");
    applyAgentEvent(state, ev("item/completed", { type: "fileRead", id: "f1" }));
    // Only the background task is left; it says so rather than "Thinking".
    expect(state.current?.label).toBe("Background task");
    applyAgentEvent(state, ev("item/backgroundTask/completed", undefined, { itemId: "b1" }));
    expect(state.current?.kind).toBe("thinking");
  });

  it("drops stale background tasks when a new turn starts", () => {
    const state = initialAgentActivityState();
    applyAgentEvent(state, ev("turn/started"));
    applyAgentEvent(state, ev("item/started", { type: "backgroundTask", id: "b1", description: "Old" }));
    applyAgentEvent(state, ev("turn/completed"));
    applyAgentEvent(state, ev("turn/started"));
    expect(state.open.size).toBe(0);
    expect(state.current?.label).toBe("Starting");
  });

  it("treats an item as proof of a turn when the tail has no turn/started", () => {
    const state = initialAgentActivityState();
    applyAgentEvent(state, ev("item/started", { type: "reasoning", id: "r" }));
    expect(state.current?.label).toBe("Thinking");
  });

  it("skips events it has already seen and ones it does not care about", () => {
    const state = initialAgentActivityState();
    const started = ev("turn/started");
    applyAgentEvent(state, started);
    expect(applyAgentEvent(state, started)).toBe(false);
    expect(applyAgentEvent(state, ev("item/reasoning/textDelta", undefined, { delta: "x" }))).toBe(false);
    expect(state.current?.label).toBe("Starting");
  });

  it("reports a batch as changed only when the resolved activity moved", () => {
    const state = initialAgentActivityState();
    applyAgentEvents(state, [ev("turn/started"), ev("item/started", { type: "reasoning", id: "r" })]);
    expect(
      applyAgentEvents(state, [
        ev("item/completed", { type: "reasoning", id: "r" }),
        ev("item/started", { type: "reasoning", id: "r2" }),
      ]),
    ).toBe(false);
    expect(
      applyAgentEvents(state, [ev("item/started", { type: "agentMessage", id: "m" })]),
    ).toBe(true);
  });
});
