import { containsThread } from "./contains-thread";
import type { ThreadNode } from "./resolve";

export const SECTION_PREVIEW_SIZE = 25;

export function previewRoots({
  roots,
  limit,
  activeThreadId,
}: {
  roots: readonly ThreadNode[];
  limit: number;
  activeThreadId: string | null;
}): ThreadNode[] {
  return roots.filter((root, index) =>
    index < limit || (activeThreadId !== null && containsThread(root, activeThreadId)),
  );
}
