// Which chevrons have to be open before a row can be on screen.
//
// containsThread answers yes/no, and hasPendingDescendant is a boolean on the
// root, so the sidebar could only ever expand the root — which is exactly why
// a waiting or active thread at depth >= 2 stayed hidden behind its
// intermediate ancestors. This names the ancestors instead.
import type { ThreadNode } from "./resolve";

export interface RevealPath {
  /**
   * `${threadId}:${reason}`. The caller remembers this so a reveal happens
   * once per reason and a later deliberate collapse is not fought.
   */
  key: string;
  /**
   * Ids from the root down to, but excluding, the matched row. Every one of
   * them must be expanded; the match's own chevron is irrelevant.
   */
  ancestorIds: string[];
}

/**
 * Every ancestor chain that has to be expanded for the rows `reasonFor`
 * selects to be visible. A matching root yields nothing: it is already on
 * screen, and expanding it would open its subtree rather than reveal it.
 */
export function revealPaths(
  roots: readonly ThreadNode[],
  reasonFor: (node: ThreadNode) => string | null,
): RevealPath[] {
  const found: RevealPath[] = [];
  const chain: string[] = [];
  const walk = (node: ThreadNode) => {
    if (chain.length > 0) {
      const reason = reasonFor(node);
      if (reason !== null) {
        found.push({
          key: `${node.thread.id}:${reason}`,
          ancestorIds: [...chain],
        });
      }
    }
    chain.push(node.thread.id);
    for (const child of node.children) walk(child);
    chain.pop();
  };
  for (const root of roots) walk(root);
  return found;
}
