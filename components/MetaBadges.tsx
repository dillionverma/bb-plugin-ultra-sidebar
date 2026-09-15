// The metadata line under a thread title.
//
// Design rules, applied consistently so a row reads as one thing rather than a
// pile of chips:
//   - an icon carries the category, the text carries the value;
//   - anything absent renders nothing at all — no "unknown" placeholders, no
//     em dashes holding space for data this thread never had;
//   - a badge that stands for something openable — the checkout folder, the
//     pull request — is a link: hover names the destination, click goes there.
//     Every other badge stays inert, so the row's detail card remains the one
//     place that explains every value at once.
import type { ReactNode } from "react";
import type { ThreadPullRequest } from "@/hooks/useThreadPullRequests";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatHomePathForDisplay } from "@/lib/utils";

/**
 * A badge that opens something. It sits inside the row's anchor, so every
 * event that would open, drag or rename the row is stopped here.
 */
export function LinkBadge({
  icon,
  label,
  tip,
  onOpen,
  className,
  maxWidth = "8rem",
}: {
  icon: string;
  label: string;
  /** What the hover says: the folder path, the pull request title. */
  tip: ReactNode;
  onOpen(): void;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
          }}
          className={cn(
            "flex min-w-0 shrink items-center gap-1 rounded-sm text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground hover:underline",
            className,
          )}
        >
          <Icon name={icon} className="size-2.5 shrink-0 opacity-70" />
          <span className="truncate" style={{ maxWidth }}>
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[24rem] break-all">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

export function Badge({
  icon,
  label,
  className,
  maxWidth = "8rem",
}: {
  icon: string;
  label: string;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 shrink items-center gap-1 text-[11px] leading-4 text-muted-foreground",
        className,
      )}
    >
      <Icon name={icon} className="size-2.5 shrink-0 opacity-70" />
      <span className="truncate" style={{ maxWidth }}>
        {label}
      </span>
    </span>
  );
}

/** The tooltip for a folder link: the path, and where it is if not here. */
export function folderTip(path: string, hostName: string | null): string {
  const shown = formatHomePathForDisplay(path);
  return hostName === null ? shown : `${shown} · ${hostName}`;
}

export function ProjectBadge({
  name,
  folder,
  onOpenFolder,
}: {
  name: string;
  /** The checkout behind this row, once known; null keeps the badge inert. */
  folder?: { path: string; hostName: string | null } | null;
  onOpenFolder?(): void;
}) {
  if (folder == null || onOpenFolder === undefined) {
    return <Badge icon="Folder" label={name} maxWidth="7rem" />;
  }
  return (
    <LinkBadge
      icon="Folder"
      label={name}
      maxWidth="7rem"
      tip={folderTip(folder.path, folder.hostName)}
      onOpen={onOpenFolder}
    />
  );
}

export function BranchBadge({
  branch,
  folder,
  onOpenFolder,
}: {
  branch: string;
  folder?: { path: string; hostName: string | null } | null;
  onOpenFolder?(): void;
}) {
  if (folder == null || onOpenFolder === undefined) {
    return <Badge icon="FolderGit" label={branch} />;
  }
  return (
    <LinkBadge
      icon="FolderGit"
      label={branch}
      tip={folderTip(folder.path, folder.hostName)}
      onOpen={onOpenFolder}
    />
  );
}

export function MachineBadge({ name }: { name: string }) {
  return <Badge icon="ComputerTerminal01" label={name} maxWidth="5rem" />;
}

export function ModelBadge({ model }: { model: string }) {
  return <Badge icon="Bot" label={shortenModel(model)} maxWidth="6rem" />;
}

const MODEL_FAMILIES =
  /^(opus|sonnet|haiku|fable|gpt|gemini|llama|mistral|codex|o\d)$/i;

/**
 * Model ids are long, front-loaded with vendor noise and back-loaded with
 * build dates: "claude-opus-5-20250101", "us.anthropic.claude-sonnet-5-v1".
 * Keep the family and the parts that actually distinguish one from another,
 * and drop the date stamp. The full id lives in the row's detail card.
 */
export function shortenModel(model: string): string {
  const cleaned = model.replace(/\[[^\]]*\]$/, "");
  const segments = cleaned.split(/[-/.]/).filter((part) => part !== "");
  const familyAt = segments.findIndex((part) => MODEL_FAMILIES.test(part));

  if (familyAt === -1) {
    const tail = segments.at(-1) ?? cleaned;
    return tail.length > 18 ? `${tail.slice(0, 17)}…` : tail;
  }

  const kept = [segments[familyAt]!.toLowerCase()];
  for (const part of segments.slice(familyAt + 1, familyAt + 3)) {
    // A build date or a bare "v1" tells the user nothing at this size.
    if (/^\d{6,}$/.test(part) || /^v\d+$/i.test(part)) break;
    if (part.length > 6) break;
    kept.push(part.toLowerCase());
  }
  return kept.join("-");
}

export const PR_ATTENTION: Record<string, { text: string; className: string }> = {
  checks_failed: { text: "Checks failed", className: "text-destructive" },
  conflicts: { text: "Conflicts", className: "text-destructive" },
  changes_requested: { text: "Changes requested", className: "text-destructive" },
  blocked: { text: "Blocked", className: "text-destructive" },
  checks_pending: { text: "Checks running", className: "text-muted-foreground" },
  review_requested: { text: "Review requested", className: "text-foreground" },
  ready_to_merge: { text: "Ready to merge", className: "text-primary" },
  merged: { text: "Merged", className: "text-muted-foreground" },
  closed: { text: "Closed", className: "text-muted-foreground" },
  draft: { text: "Draft", className: "text-muted-foreground" },
  none: { text: "Open", className: "text-muted-foreground" },
};

function prIcon(pullRequest: ThreadPullRequest): string {
  if (pullRequest.state === "merged") return "CircleCheck";
  if (pullRequest.state === "closed") return "CircleX";
  if (pullRequest.attention === "checks_failed") return "AlertCircle";
  if (pullRequest.attention === "conflicts") return "AlertTriangle";
  return "FolderGit";
}

/**
 * Takes the pull request rather than fetching one: the lookup is batched on
 * the server now, so a row no longer pays a git-host round trip of its own.
 */
export function PullRequestBadge({
  pullRequest,
  onOpen,
}: {
  pullRequest: ThreadPullRequest;
  /** Opens the pull request on the git host; omitted, the badge is inert. */
  onOpen?(): void;
}) {
  const attention = PR_ATTENTION[pullRequest.attention] ?? PR_ATTENTION.none!;
  if (onOpen === undefined) {
    return (
      <Badge
        icon={prIcon(pullRequest)}
        label={`#${pullRequest.number}`}
        maxWidth="4rem"
        className={attention.className}
      />
    );
  }
  return (
    <LinkBadge
      icon={prIcon(pullRequest)}
      label={`#${pullRequest.number}`}
      maxWidth="4rem"
      className={attention.className}
      tip={
        <span className="flex flex-col gap-0.5">
          <span>
            #{pullRequest.number} {pullRequest.title}
          </span>
          <span className="opacity-80">
            {pullRequest.state} · {attention.text}
          </span>
        </span>
      }
      onOpen={onOpen}
    />
  );
}

/** "2m", "4h", "3d" — sidebar rows have no room for anything longer. */
export function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.round(weeks / 52)}y`;
}

export function absoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
