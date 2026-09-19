// A quick read of a thread, with less-frequent details behind one disclosure.
import {
  experimental_ProviderIcon as ProviderIcon,
  UrlLink,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { GoalDetails } from "./GoalDetails";
import { PlanDetails } from "./PlanDetails";
import { ModeIcon } from "./ThreadModes";
import { useThreadQueue } from "../hooks/useThreadQueue";
import { MachineIcon } from "./MachineIndicator";
import { ProjectIcon } from "./ProjectIcon";
import { cn, formatHomePathForDisplay } from "@/lib/utils";
import { useThreadExecution, type ThreadExecution } from "@/hooks/useThreadExecution";
import { useSidebar, type ProviderInfo } from "./sidebar-context";
import { absoluteTime, PR_ATTENTION, relativeTime } from "./MetaBadges";
import { threadStatus, TONE_TEXT } from "./ThreadStatus";
import type { ThreadPullRequest } from "@/hooks/useThreadPullRequests";
import type { ManualStatus } from "@/lib/status";
import { flattenStack, StackList, usePullRequestStack } from "./PullRequestStack";
import { SubtreeChildList } from "./SubtreeSummary";
import type { ThreadNode } from "@/lib/resolve";

function Fact({ icon, label, children }: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-xs leading-4">
      <span aria-hidden className="mt-px flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
        <Icon name={icon} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </div>
  );
}

const ACTIVITY_LABELS: Array<[keyof PluginSidebarThread["activity"], string]> = [
  ["workflows", "workflow"],
  ["backgroundAgents", "background agent"],
  ["backgroundCommands", "background command"],
];

export function ThreadDetails({
  thread,
  projectName,
  provider,
  execution: cachedExecution,
  pullRequest,
  manualStatus = null,
  descendantCount,
  node,
}: {
  thread: PluginSidebarThread;
  projectName: string;
  provider: ProviderInfo | null;
  execution: ThreadExecution | undefined;
  pullRequest: ThreadPullRequest | undefined;
  manualStatus?: ManualStatus | null;
  descendantCount: number;
  /** The tree node, when the caller has one, so the card can name the children. */
  node?: ThreadNode;
}) {
  // Row settings can hide the model, but an open detail card still needs it.
  const execution = useThreadExecution([thread], cachedExecution === undefined).get(thread.id) ?? cachedExecution;
  const runningCounts = ACTIVITY_LABELS.flatMap(([key, noun]) => {
    const count = thread.activity[key];
    return count === 0 ? [] : [`${count} ${noun}${count === 1 ? "" : "s"}`];
  });
  const status = threadStatus(thread, pullRequest, manualStatus);
  const inMotion = status?.tone === "working";
  const needsResponse = thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
  const queue = useThreadQueue(thread.id);
  const sidebar = useSidebar();
  const environmentId = thread.environment?.id ?? null;
  const folder = environmentId === null ? null : sidebar.locationOf(environmentId);
  const attention = pullRequest === undefined ? null : (PR_ATTENTION[pullRequest.attention] ?? PR_ATTENTION.none!);
  const { data: stack } = usePullRequestStack(thread.id);
  const stackSize = stack === null ? 0 : flattenStack(stack.stack).length;
  const model = execution?.model ?? provider?.displayName ?? null;
  const reasoning = execution?.reasoningLevel === "none" ? null : execution?.reasoningLevel;
  const configuration = [
    { label: "Agent", value: provider?.displayName },
    { label: "Environment", value: thread.environment?.name },
    { label: "Permissions", value: execution?.permissionMode },
    { label: "Service", value: execution?.serviceTier },
  ].filter(({ value }) => value != null && value !== "");
  const hasDetails = configuration.length > 0 || folder !== null;
  const age = relativeTime(thread.updatedAt);
  const updatedLabel = age === "now" ? "Just now" : `${age} ago`;
  const modelLine = model === null ? null : (
    <span className="inline-flex min-w-0 flex-1 items-center gap-1.5" title={[model, reasoning].filter(Boolean).join(" · ")}>
      {provider === null ? <Icon name="Bot" aria-hidden className="size-3.5 shrink-0" /> : <ProviderIcon providerKind="agent" provider={provider} className="size-3.5 shrink-0" />}
      <span className="sr-only">{execution?.model == null ? "Agent" : "Model"}: </span>
      <span className="min-w-0 truncate text-foreground/85">{model}</span>
      {reasoning ? <span className="shrink-0 text-muted-foreground">· {reasoning}</span> : null}
    </span>
  );

  return (
    <div
      data-thread-details=""
      className={cn("flex max-w-full flex-col gap-2", stackSize >= 2 ? "w-[26rem]" : "w-72")}
      // Hover-card content is also portaled through the row. Its disclosure,
      // links and text selection must never open, rename or drag that row.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) event.stopPropagation();
      }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <h3 className="min-w-0 flex-1 break-words text-xs font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
          {thread.title ?? thread.titleFallback ?? "Untitled"}
        </h3>
        {status === null ? null : (
          <span
            className={cn("shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4", status.tone === "needs-you" ? "bb-ws-your-turn" : cn("bg-muted/70", TONE_TEXT[status.tone]))}
            title={status.detail}
          >{status.text}</span>
        )}
      </div>

      {projectName !== "" || thread.host !== null || !inMotion ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
          {projectName === "" ? null : (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={`Project: ${projectName}`}>
              <ProjectIcon projectId={thread.projectId} className="size-3" />
              <span className="sr-only">Project: </span>
              <span className="truncate">{projectName}</span>
            </span>
          )}
          {thread.host === null ? null : (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={`Machine: ${thread.host.name}`}>
              <MachineIcon name={thread.host.name} className="size-3 shrink-0" />
              <span className="sr-only">Machine: </span>
              <span className="truncate">{thread.host.name}</span>
            </span>
          )}
          {inMotion ? null : (
            <time
              className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/80"
              dateTime={new Date(thread.updatedAt).toISOString()}
              title={`Thread updated ${absoluteTime(thread.updatedAt)}`}
              aria-label={`Thread updated ${updatedLabel.toLowerCase()}`}
            >{updatedLabel}</time>
          )}
        </div>
      ) : null}

      {thread.environment?.branchName == null ? null : (
        <Fact icon="FolderGit" label="Branch">
          <span className="break-all font-mono text-[11px] text-muted-foreground">{thread.environment.branchName}</span>
        </Fact>
      )}

      {hasDetails ? (
        <details className="group/details">
          <summary className="flex min-h-5 cursor-pointer list-none items-center gap-2 rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {modelLine}
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px]">
              Details
              <Icon name="ChevronDown" aria-hidden className="size-3 transition-transform group-open/details:rotate-180" />
            </span>
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-muted/40 p-2 text-[11px] leading-4 text-muted-foreground">
            {configuration.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt>{label}</dt><dd className="min-w-0 break-words text-foreground/85 [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
            {folder === null || environmentId === null ? null : (
              <>
                <dt>Folder</dt>
                <dd className="min-w-0">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      sidebar.openFolder(environmentId);
                    }}
                    className="break-all text-left font-mono text-foreground/85 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title="Open folder"
                  >{formatHomePathForDisplay(folder.path)}</button>
                </dd>
              </>
            )}
            <dt>Updated</dt>
            <dd><time dateTime={new Date(thread.updatedAt).toISOString()}>{absoluteTime(thread.updatedAt)}</time></dd>
          </dl>
        </details>
      ) : modelLine === null ? null : <div className="flex min-w-0 text-[11px] text-muted-foreground">{modelLine}</div>}

      {status?.tone === "needs-you" || status?.tone === "problem" ? (
        <div className="flex items-start gap-3 border-t border-border pt-2 text-[11px] leading-4">
          <p className="min-w-0 flex-1 text-muted-foreground">{status.detail}</p>
          <button
            type="button"
            className={cn("inline-flex shrink-0 items-center gap-1 rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", TONE_TEXT[status.tone])}
            onClick={() => sidebar.openThread(thread.id, false)}
          >
            {needsResponse ? "Respond" : "View thread"}
            <Icon name="ArrowRight" aria-hidden className="size-3" />
          </button>
        </div>
      ) : null}

      {thread.activity.planMode > 0 || thread.indicator === "plan-mode" ? <PlanDetails threadId={thread.id} updatedAt={thread.updatedAt} /> : null}
      {thread.activity.goals > 0 || thread.indicator === "goal" ? <GoalDetails threadId={thread.id} updatedAt={thread.updatedAt} /> : null}
      {queue ? (
        <section className="flex flex-col gap-1 border-t border-border pt-2 text-[11px]" aria-label="Queued messages">
          <div className={cn("flex items-center gap-1.5 font-medium", queue.failed ? "ws-tone-danger" : "text-muted-foreground")}>
            <ModeIcon kind="schedule" />
            {queue.failed ? "Queue failed" : queue.retry ? "Retry queued" : "Queued messages"}
            <span className="ml-auto font-normal tabular-nums">{queue.count} message{queue.count === 1 ? "" : "s"}</span>
          </div>
          {queue.sendAt !== null ? <p className="text-muted-foreground">{new Date(queue.sendAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p> : null}
        </section>
      ) : null}

      {stack !== null && stackSize >= 2 ? (
        <div className="border-t border-border pt-2">
          <span className="sr-only">Pull request stack, {stack.repo}: </span>
          <StackList data={stack} Link={UrlLink} />
        </div>
      ) : pullRequest === undefined || attention === null ? null : (
        <div className="border-t border-border pt-2">
          <Fact icon="FolderGit" label="Pull request">
            <UrlLink href={pullRequest.url} className="flex flex-col gap-0.5 rounded-sm hover:underline" title={pullRequest.url}>
              <span>#{pullRequest.number} {pullRequest.title}</span>
              <span className={cn("text-[11px]", attention.className)}>{pullRequest.state} · {attention.text}</span>
            </UrlLink>
          </Fact>
        </div>
      )}

      {descendantCount === 0 && runningCounts.length === 0 ? null : (
        <div className="flex flex-col gap-1.5 text-muted-foreground">
          {descendantCount === 0 ? null : (
            <Fact icon="Bot" label="Nested threads">
              {descendantCount} nested thread{descendantCount === 1 ? "" : "s"}
              {/* Named, not just counted: the row's chip already says how many
                  and how urgent, so the only thing left to say is which. */}
              {node === undefined ? null : (
                <div className="mt-1.5">
                  <SubtreeChildList node={node} />
                </div>
              )}
            </Fact>
          )}
          {runningCounts.length === 0 ? null : <Fact icon="Workflow" label="Running">{runningCounts.join(", ")}</Fact>}
        </div>
      )}
    </div>
  );
}
