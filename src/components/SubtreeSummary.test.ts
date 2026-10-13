import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadNode } from "@/lib/resolve";
import { subtreeLabel, subtreeTone } from "./SubtreeSummary";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "t",
    title: "t",
    titleFallback: null,
    hasPendingInteraction: false,
    isUnread: false,
    indicator: "none",
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    ...overrides,
  } as PluginSidebarThread;
}

function node(overrides: Partial<ThreadNode> = {}): ThreadNode {
  return {
    thread: thread(),
    depth: 0,
    children: [],
    descendantCount: 0,
    hasUnreadDescendant: false,
    hasPendingDescendant: false,
    hasWorkingDescendant: false,
    doneDescendants: 0,
    ...overrides,
  } as ThreadNode;
}

describe("subtreeTone", () => {
  it("puts the actionable state first", () => {
    // All three at once: the one a person can act on has to win, or the chip
    // would report "working" on a subtree that is actually blocked on them.
    expect(
      subtreeTone(
        node({
          hasPendingDescendant: true,
          hasWorkingDescendant: true,
          hasUnreadDescendant: true,
        }),
      ),
    ).toBe("needs-you");
  });

  it("prefers working over unread", () => {
    expect(
      subtreeTone(
        node({ hasWorkingDescendant: true, hasUnreadDescendant: true }),
      ),
    ).toBe("working");
  });

  it("falls back to unread, then idle", () => {
    expect(subtreeTone(node({ hasUnreadDescendant: true }))).toBe("unread");
    expect(subtreeTone(node())).toBe("idle");
  });

  it("puts progress in the label once anything is done", () => {
    const half = node({ descendantCount: 13, doneDescendants: 3 });
    expect(subtreeLabel(half, subtreeTone(half))).toBe(
      "13 nested threads, 3 done",
    );
    // Nothing finished yet: no "0 done" noise.
    const none = node({ descendantCount: 13 });
    expect(subtreeLabel(none, subtreeTone(none))).toBe("13 nested threads");
  });

  it("names the state in the label rather than only colouring it", () => {
    const busy = node({ descendantCount: 3, hasWorkingDescendant: true });
    expect(subtreeLabel(busy, subtreeTone(busy))).toBe(
      "3 nested threads · working",
    );
    const one = node({ descendantCount: 1 });
    expect(subtreeLabel(one, subtreeTone(one))).toBe("1 nested thread");
  });
});
