export interface ThreadTreeNode {
  thread: { id: string };
  children: unknown[];
}

/** Whether `threadId` is this node or anywhere in its subtree. */
export function containsThread(
  node: ThreadTreeNode,
  threadId: string | null,
): boolean {
  if (threadId === null) return false;
  if (node.thread.id === threadId) return true;
  return (node.children as ThreadTreeNode[]).some((child) =>
    containsThread(child, threadId),
  );
}
