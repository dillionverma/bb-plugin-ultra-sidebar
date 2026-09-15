import { describe, expect, it, vi } from "vitest";
import { createNativeSubagentsReader } from "./native-subagents.server";
import type { NativeSubagentEntry } from "./native-subagents";

function delegationRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: "work",
    workKind: "delegation",
    childRef: "agent-1",
    description: "Explore the repo",
    presentation: null,
    subagentType: "Explore",
    status: "pending",
    startedAt: 10,
    callId: "call-1",
    sourceSeqStart: 3,
    childRows: [],
    ...overrides,
  };
}

function event(
  seq: number,
  type: string,
  item: Record<string, unknown> | null,
  createdAt = seq * 10,
): Record<string, unknown> {
  return { seq, type, createdAt, data: item === null ? {} : { item } };
}

/** A stand-in for the host's threads API with a scripted event log. */
function fakeThreads(
  rows: Record<string, unknown>[],
  pages: Record<string, unknown>[][],
  maxSeq = 5,
) {
  const remaining = [...pages];
  return {
    timeline: vi.fn(async () => ({ rows, maxSeq })),
    events: {
      list: vi.fn(async () => remaining.shift() ?? []),
    },
  } as unknown as Parameters<typeof createNativeSubagentsReader>[0];
}

describe("createNativeSubagentsReader", () => {
  it("seeds a parent from its current timeline, nested rows included", async () => {
    const reader = createNativeSubagentsReader(
      fakeThreads(
        [
          delegationRow({
            childRows: [
              delegationRow({
                childRef: "agent-2",
                callId: "call-2",
                description: "Read the tests",
                startedAt: 20,
                status: "completed",
              }),
            ],
          }),
        ],
        [],
      ),
      () => {},
      () => {},
    );

    const entry = await reader.read("parent");

    expect(entry.agents).toEqual([
      {
        id: "agent-1",
        label: "Explore the repo",
        status: "pending",
        startedAt: 10,
        depth: 0,
      },
      {
        id: "agent-2",
        label: "Read the tests",
        status: "completed",
        startedAt: 20,
        depth: 1,
      },
    ]);
  });

  it("publishes when new events add and then finish an agent", async () => {
    const published: NativeSubagentEntry[] = [];
    const reader = createNativeSubagentsReader(
      fakeThreads(
        [],
        [
          [
            event(6, "item/started", {
              type: "delegation",
              id: "call-9",
              childRef: "agent-9",
              label: "Review the diff",
              status: "pending",
            }),
          ],
          [
            event(7, "item/delegation/completed", {
              type: "delegation",
              id: "call-9",
              childRef: "agent-9",
              label: "Review the diff",
              status: "completed",
            }),
          ],
        ],
      ),
      (entry) => published.push(entry),
      () => {},
    );

    await reader.read("parent");
    await reader.update("parent", 6);
    await reader.update("parent", 7);

    expect(published.map((entry) => entry.agents[0]?.status)).toEqual([
      "pending",
      "completed",
    ]);
    // A completion keeps the moment the agent started, not its own timestamp.
    expect(published[1]!.agents[0]!.startedAt).toBe(60);
  });

  it("marks agents still running as interrupted when the thread is stopped", async () => {
    const published: NativeSubagentEntry[] = [];
    const reader = createNativeSubagentsReader(
      fakeThreads(
        [delegationRow()],
        [[event(6, "system/thread/interrupted", null)]],
      ),
      (entry) => published.push(entry),
      () => {},
    );

    await reader.read("parent");
    await reader.update("parent", 6);

    expect(published.at(-1)?.agents[0]?.status).toBe("interrupted");
  });

  it("reports a thread it cannot follow instead of throwing", async () => {
    const warnings: string[] = [];
    const threads = fakeThreads([], []);
    threads.events.list = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof threads.events.list;
    const reader = createNativeSubagentsReader(
      threads,
      () => {},
      (message) => warnings.push(message),
    );

    await reader.read("parent");
    await reader.update("parent", 6);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("parent");
  });
});
