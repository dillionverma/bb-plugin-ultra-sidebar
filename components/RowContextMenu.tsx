// The keyboard-reachable twin of every drag gesture.
//
// bb ships no menu for a replaced thread list, but exposes everything its own
// menu does through experimental_useSidebarThreadActions — including
// requestDelete, which opens bb's confirmation rather than deleting silently.
import { useRef, type ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
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
import { STATUS_BUCKETS, type ManualStatus } from "@/lib/status";
import { useSidebar } from "./sidebar-context";
import { StatusIcon } from "./StatusIcon";

const STATUS_CHOICES = STATUS_BUCKETS.flatMap((bucket) =>
  bucket.key === "in-review"
    ? []
    : [
        {
          key: bucket.key,
          label: bucket.label,
          value: (bucket.key === "in-progress"
            ? null
            : bucket.key) as ManualStatus | null,
        },
      ],
);

const SNOOZE_CHOICES = [
  { label: "For an hour", ms: 60 * 60 * 1000 },
  { label: "For 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "For a day", ms: 24 * 60 * 60 * 1000 },
  { label: "For a week", ms: 7 * 24 * 60 * 60 * 1000 },
];

function MoveMenu({
  item,
  currentWorkspaceId,
  canReorder = true,
}: {
  item: ItemRef;
  currentWorkspaceId: string | null;
  canReorder?: boolean;
}) {
  const sidebar = useSidebar();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon name="MoveTo" />
        Move
        <ContextMenuShortcut>M</ContextMenuShortcut>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        <ContextMenuGroup aria-label="Workspace destination">
          <ContextMenuLabel>Move to workspace</ContextMenuLabel>
          {sidebar.workspaces.length === 0 ? (
            <ContextMenuItem disabled>
              <Icon name="Folder" />No workspaces yet
            </ContextMenuItem>
          ) : sidebar.workspaces.map((workspace) => (
            <ContextMenuItem
              key={workspace.id}
              disabled={workspace.id === currentWorkspaceId}
              onSelect={() => sidebar.moveTo(item, workspace.id)}
            >
              <Icon name="Folder" />
              <span className="min-w-0 truncate">{workspace.name}</span>
              {workspace.id === currentWorkspaceId && <Icon name="Check" className="ml-auto" />}
            </ContextMenuItem>
          ))}
          {item.kind === "thread" && (
            <ContextMenuItem
              disabled={currentWorkspaceId === null}
              onSelect={() => sidebar.moveTo(item, null)}
            >
              <Icon name="FolderUnknown" />Unassigned
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => sidebar.clearItem(item)}>
            <Icon name="FolderSync" />
            {item.kind === "thread" ? "Follow its project" : "Remove from workspace"}
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup aria-label="Order in group">
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
  currentWorkspaceId,
  thread,
  manualStatus,
  pullRequestUrl = null,
  onRename,
}: {
  children: ReactNode;
  item: ItemRef;
  currentWorkspaceId: string | null;
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
          <MoveMenu item={item} currentWorkspaceId={currentWorkspaceId} canReorder={thread.parentThreadId === null} />
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
          <ContextMenuItem onSelect={() => sidebar.setPinned(thread.id, !thread.isPinned)}>
            <Icon name={thread.isPinned ? "PinOff" : "Pin"} />
            {thread.isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
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

export function ProjectContextMenu({
  children,
  projectId,
  currentWorkspaceId,
}: {
  children: ReactNode;
  projectId: string;
  currentWorkspaceId: string | null;
}) {
  const sidebar = useSidebar();
  const item: ItemRef = { kind: "project", refId: projectId };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={() => sidebar.newThreadIn(projectId)}>
            <Icon name="MessageSquarePlus" />New thread here
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <MoveMenu item={item} currentWorkspaceId={currentWorkspaceId} />
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WorkspaceContextMenu({
  children,
  workspaceId,
  sortMode,
  onRename,
}: {
  children: ReactNode;
  workspaceId: string | null;
  sortMode: "recent" | "manual";
  onRename(): void;
}) {
  const sidebar = useSidebar();
  const keepFocus = useRef(false);
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
        {workspaceId === null ? (
          <ContextMenuGroup>
            <ContextMenuItem disabled><Icon name="Info" />Items with no workspace land here</ContextMenuItem>
          </ContextMenuGroup>
        ) : (
          <ContextMenuGroup aria-label="Workspace actions">
            <ContextMenuItem
              onSelect={() => {
                keepFocus.current = true;
                onRename();
              }}
            >
              <Icon name="Edit" />Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                sidebar.setSortMode(
                  workspaceId,
                  sortMode === "manual" ? "recent" : "manual",
                )
              }
            >
              <Icon name="Sort" />
              {sortMode === "manual"
                ? "Sort by most recent"
                : "Keep my manual order"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => sidebar.removeWorkspace(workspaceId)}
            >
              <Icon name="Trash2" />Delete workspace
            </ContextMenuItem>
          </ContextMenuGroup>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
