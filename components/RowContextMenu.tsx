// The keyboard-reachable twin of every drag gesture.
//
// bb ships no menu for a replaced thread list, but exposes everything its own
// menu does through experimental_useSidebarThreadActions — including
// requestDelete, which opens bb's confirmation rather than deleting silently.
import { useRef, type ReactNode } from "react";
import { toast } from "sonner";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuShortcut,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import type { ItemRef } from "@/lib/types";
import type { Section } from "@/lib/sections";
import { STATUS_BUCKETS, canFileInto, type ManualStatus } from "@/lib/status";
import { useSidebar } from "./sidebar-context";
import { StatusIcon } from "./StatusIcon";

const STATUS_CHOICES = STATUS_BUCKETS.filter((bucket) =>
  canFileInto(bucket.key),
).map((bucket) => ({
  key: bucket.key,
  label: bucket.label,
  // In progress is the absence of a manual status, not one of its own.
  value: (bucket.key === "in-progress"
    ? null
    : bucket.key) as ManualStatus | null,
}));

const SNOOZE_CHOICES = [
  { label: "For an hour", ms: 60 * 60 * 1000 },
  { label: "For 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "For a day", ms: 24 * 60 * 60 * 1000 },
  { label: "For a week", ms: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Everything the drag does, from the keyboard. A thread cannot be dragged
 * into another project — bb owns that — so what is left is its position in
 * the list it is already in.
 */
function OrderMenu({ item, canReorder = true }: { item: ItemRef; canReorder?: boolean }) {
  const sidebar = useSidebar();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon name="Sort" />
        Order
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        <ContextMenuGroup aria-label="Order in section">
          <ContextMenuItem onSelect={() => sidebar.nudge(item, -1)} disabled={!canReorder}>
            <Icon name="ArrowUp" />Move up
            <ContextMenuShortcut>Alt ↑</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => sidebar.nudge(item, 1)} disabled={!canReorder}>
            <Icon name="ArrowDown" />Move down
            <ContextMenuShortcut>Alt ↓</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function RowContextMenu({
  children,
  item,
  thread,
  manualStatus,
  pullRequestUrl = null,
  onRename,
}: {
  children: ReactNode;
  item: ItemRef;
  thread: PluginSidebarThread;
  manualStatus: ManualStatus | null;
  /** The thread's pull request on the git host, when it has one. */
  pullRequestUrl?: string | null;
  onRename(): void;
}) {
  const sidebar = useSidebar();
  // Radix returns focus to the trigger when the menu closes. For every item
  // but Rename that is what we want; for Rename it blurs the input that just
  // opened, which commits an empty edit and closes it again.
  const keepFocus = useRef(false);
  const copyThreadLink = async () => {
    const path = thread.projectId === "proj_personal"
      ? `/threads/${encodeURIComponent(thread.id)}`
      : `/projects/${encodeURIComponent(thread.projectId)}/threads/${encodeURIComponent(thread.id)}`;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      toast.success("Thread link copied");
    } catch {
      toast.error("Couldn't copy thread link");
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        onCloseAutoFocus={(event) => {
          if (!keepFocus.current) return;
          keepFocus.current = false;
          event.preventDefault();
        }}
      >
        <ContextMenuGroup aria-label="Open thread">
          <ContextMenuItem onSelect={() => { void copyThreadLink(); }}>
            <Icon name="Copy" />Copy thread link
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => sidebar.openThread(thread.id, false)}>
            <Icon name="MessageSquare" />Open
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => sidebar.openThread(thread.id, true)}>
            <Icon name="Columns2" />Open in split
            <ContextMenuShortcut>Shift ↵</ContextMenuShortcut>
          </ContextMenuItem>
          {thread.environment?.id != null && (
            <ContextMenuItem onSelect={() => sidebar.openFolder(thread.environment!.id!)}>
              <Icon name="FolderOpen" />Open folder
            </ContextMenuItem>
          )}
          {pullRequestUrl !== null && (
            <ContextMenuItem onSelect={() => sidebar.openUrl(pullRequestUrl)}>
              <Icon name="GitPullRequest" />Open pull request
            </ContextMenuItem>
          )}
          {thread.indicator === "unread-error" && (
            <ContextMenuItem onSelect={() => sidebar.retryThread(thread.id)}>
              <Icon name="RotateCcw" />Retry failed turn
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup aria-label="Organize thread">
          {/* Only a root pins. A subagent's place is under the thread that
              spawned it, so the Pinned list would never show it and the
              action would be a silent no-op. */}
          {thread.parentThreadId === null && (
            <ContextMenuItem onSelect={() => sidebar.setPinned(thread.id, !thread.isPinned)}>
              <Icon name={thread.isPinned ? "PinOff" : "Pin"} />
              {thread.isPinned ? "Unpin from top" : "Pin to top"}
              <ContextMenuShortcut>P</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <OrderMenu item={item} canReorder={thread.parentThreadId === null} />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="CircleCheck" />Status
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuGroup aria-label="Thread status">
                {/* In review follows the pull request; In progress clears the manual choice. */}
                {STATUS_CHOICES.map((choice) => (
                  <ContextMenuItem
                    key={choice.key}
                    disabled={manualStatus === choice.value}
                    onSelect={() => sidebar.setStatus(thread.id, choice.value)}
                  >
                    <StatusIcon tone={choice.key} />
                    {choice.label}
                    {choice.key === "done" && <ContextMenuShortcut>D</ContextMenuShortcut>}
                  </ContextMenuItem>
                ))}
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="Clock" />Snooze
              <ContextMenuShortcut>S</ContextMenuShortcut>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuGroup aria-label="Snooze duration">
                {SNOOZE_CHOICES.map((choice) => (
                  <ContextMenuItem key={choice.label} onSelect={() => sidebar.setSnoozed(thread.id, Date.now() + choice.ms)}>
                    <Icon name="Clock" />{choice.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem onSelect={() => sidebar.setSnoozed(thread.id, null)}>
                  <Icon name="Play" />Wake now
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup aria-label="Thread preferences">
          <ContextMenuItem onSelect={() => sidebar.setRead(thread.id, thread.isUnread)}>
            <Icon name={thread.isUnread ? "MailOpen" : "Mail"} />
            {thread.isUnread ? "Mark read" : "Mark unread"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => { keepFocus.current = true; onRename(); }}>
            <Icon name="Edit" />Rename
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup aria-label="Remove thread">
          <ContextMenuItem onSelect={() => sidebar.archiveThread(thread.id)}>
            <Icon name="Archive" />Archive
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => sidebar.deleteThread(thread.id)}>
            <Icon name="Trash2" />Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The heading's menu. Which items it carries depends on what the heading is:
 * only a project can start a thread, and only a hand-ordered section has an
 * order worth dropping.
 */
export function SectionContextMenu({
  children,
  section,
}: {
  children: ReactNode;
  section: Section;
}) {
  const sidebar = useSidebar();
  const projectId = section.projectId;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {projectId !== null && (
          <>
            <ContextMenuGroup>
              <ContextMenuItem onSelect={() => sidebar.newThreadIn(projectId)}>
                <Icon name="MessageSquarePlus" />New thread here
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup aria-label="Order projects">
              <ContextMenuItem
                onSelect={() => sidebar.nudge({ kind: "project", refId: projectId }, -1)}
              >
                <Icon name="ArrowUp" />Move project up
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => sidebar.nudge({ kind: "project", refId: projectId }, 1)}
              >
                <Icon name="ArrowDown" />Move project down
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        )}
        {section.kind === "pinned" && (
          <ContextMenuGroup>
            <ContextMenuItem disabled>
              <Icon name="Info" />Pinned threads stay at the top
            </ContextMenuItem>
          </ContextMenuGroup>
        )}
        {/* The one heading nothing can be dropped on, so it says why rather
            than leaving a dead target to be discovered by trying. */}
        {section.bucket !== null && !canFileInto(section.bucket) && (
          <ContextMenuGroup>
            <ContextMenuItem disabled>
              <Icon name="Info" />In review follows the pull request
            </ContextMenuItem>
          </ContextMenuGroup>
        )}
        {section.manual && (
          <>
            <ContextMenuSeparator />
            <ContextMenuGroup aria-label="Order threads">
              <ContextMenuItem onSelect={() => sidebar.resetOrder(section.id)}>
                <Icon name="Sort" />Sort by most recent
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
