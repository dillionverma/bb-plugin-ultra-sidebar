import { describe, expect, it } from "vitest";
import { revealPaths } from "./reveal-path";
import type { ThreadNode } from "./resolve";

/** A chain of `length` nodes, each the only child of the one above. */
function chain(length: number): ThreadNode {
  const nodes: ThreadNode[] = Array.from({ length }, (_, depth) => ({
    thread: { id: `t${depth}` },
    depth,
    children: [],
    descendantCount: length - depth - 1,
    hasUnreadDescendant: false,
    hasPendingDescendant: false,
  })) as unknown as ThreadNode[];
  for (let i = 0; i < length - 1; i += 1) nodes[i]!.children = [nodes[i + 1]!];
  return nodes[0]!;
}

describe("revealPaths", () => {
  it("returns every ancestor of a deep match and never the match itself", () => {
    const paths = revealPaths([chain(5)], (node) =>
      node.thread.id === "t4" ? "active" : null,
    );
    expect(paths).toHaveLength(1);
    // The assertion that would have caught the root-only reveal: four
    // ancestors, not just the root.
    expect(paths[0]!.ancestorIds).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("returns nothing for a root that matches", () => {
    const paths = revealPaths([chain(3)], (node) =>
      node.thread.id === "t0" ? "active" : null,
    );
    expect(paths).toEqual([]);
  });

  it("keys each match by its reason", () => {
    const root = chain(4);
    const both = revealPaths([root], (node) =>
      node.thread.id === "t3" ? "pending" : null,
    );
    expect(both[0]!.key).toBe("t3:pending");
    // A different reason for the same row is a different key, so revealing it
    // once for "active" cannot suppress a later "pending".
    const active = revealPaths([root], (node) =>
      node.thread.id === "t3" ? "active" : null,
    );
    expect(active[0]!.key).not.toBe(both[0]!.key);
    // Two distinct matched rows produce two distinct keys.
    const two = revealPaths([root], (node) =>
      node.thread.id === "t2" || node.thread.id === "t3" ? "pending" : null,
    );
    expect(new Set(two.map((path) => path.key)).size).toBe(2);
  });

  it("walks every root", () => {
    const paths = revealPaths([chain(2), chain(2)], (node) =>
      node.thread.id === "t1" ? "active" : null,
    );
    expect(paths).toHaveLength(2);
  });
});
