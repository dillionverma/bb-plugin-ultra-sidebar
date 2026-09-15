import { createContext, useContext } from "react";
import type { ThreadDiff } from "../hooks/useThreadDiffs";

export const ThreadDiffsContext = createContext<ReadonlyMap<string, ThreadDiff>>(new Map());

export function ThreadDiffCounts({ threadId }: { threadId: string }) {
  const diff = useContext(ThreadDiffsContext).get(threadId);
  return <>
    {diff && (diff.additions > 0 || diff.deletions > 0) ? (
      <span data-thread-diff="" role="img"
        aria-label={diff.partial
          ? `Partial diff: at least ${diff.additions.toLocaleString()} lines added, at least ${diff.deletions.toLocaleString()} lines removed`
          : `${diff.additions.toLocaleString()} lines added, ${diff.deletions.toLocaleString()} lines removed`}
        title={diff.partial ? "Known changes so far; some files could not be fully counted." : undefined}
        className="inline-flex max-w-full flex-wrap items-center justify-end gap-x-1 text-[11px] font-medium tabular-nums">
        <span aria-hidden="true" className="ws-tone-success whitespace-nowrap">+{diff.additions.toLocaleString()}</span>
        <span aria-hidden="true" className="ws-tone-danger whitespace-nowrap">−{diff.deletions.toLocaleString()}</span>
      </span>
    ) : null}
  </>;
}
