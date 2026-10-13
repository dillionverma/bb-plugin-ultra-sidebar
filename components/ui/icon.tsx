import type { CSSProperties } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  AlertCircleIcon,
  Archive03Icon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowDownDoubleIcon,
  ArrowMoveDownLeftIcon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  ArrowUpDoubleIcon,
  ArrowUpDownIcon,
  BotIcon,
  BubbleChatAddIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  ComputerTerminal01Icon,
  Copy01Icon,
  DashedLineCircleIcon,
  Delete02Icon,
  Edit02Icon,
  Folder02Icon,
  FolderGit2Icon,
  FolderIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  InformationCircleIcon,
  Layout2ColumnIcon,
  Loading03Icon,
  Mail02Icon,
  MailOpen01Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  PlusSignIcon,
  Refresh01Icon,
  RepeatIcon,
  SidebarLeftIcon,
  SlidersHorizontalIcon,
  Sorting01Icon,
  Tick02Icon,
  WorkflowCircle03Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";

// BB's icon names, drawn with the same Hugeicons glyphs BB uses for them, so
// the sidebar matches the rest of the window.
const ICONS = {
  AlertCircle: AlertCircleIcon,
  AlertTriangle: Alert02Icon,
  Archive: Archive03Icon,
  ArrowDown: ArrowDown02Icon,
  ArrowRight: ArrowRight02Icon,
  ArrowUp: ArrowUp02Icon,
  ArrowUpDown: ArrowUpDownIcon,
  Bot: BotIcon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronRight: ArrowRight01Icon,
  ChevronUp: ArrowUp01Icon,
  ChevronsDown: ArrowDownDoubleIcon,
  ChevronsUp: ArrowUpDoubleIcon,
  Circle: CircleIcon,
  CircleCheck: CheckmarkCircle02Icon,
  CircleX: CancelCircleIcon,
  Clock: Clock01Icon,
  Columns2: Layout2ColumnIcon,
  ComputerTerminal01: ComputerTerminal01Icon,
  Copy: Copy01Icon,
  CornerDownLeft: ArrowMoveDownLeftIcon,
  Edit: Edit02Icon,
  Folder: FolderIcon,
  FolderGit: FolderGit2Icon,
  FolderOpen: Folder02Icon,
  GitMerge: GitMergeIcon,
  GitPullRequest: GitPullRequestIcon,
  GitPullRequestClosed: GitPullRequestClosedIcon,
  GitPullRequestDraft: GitPullRequestDraftIcon,
  Info: InformationCircleIcon,
  ListTodo: CheckListIcon,
  Loading: Loading03Icon,
  Mail: Mail02Icon,
  MailOpen: MailOpen01Icon,
  MessageSquare: BubbleChatIcon,
  MessageSquarePlus: BubbleChatAddIcon,
  MoreHorizontal: MoreHorizontalIcon,
  PanelLeft: SidebarLeftIcon,
  Pause: PauseIcon,
  Pin: PinIcon,
  PinOff: PinOffIcon,
  Play: PlayIcon,
  Plus: PlusSignIcon,
  Repeat: RepeatIcon,
  RotateCcw: Refresh01Icon,
  SlidersHorizontal: SlidersHorizontalIcon,
  Sort: Sorting01Icon,
  Spinner: DashedLineCircleIcon,
  Trash2: Delete02Icon,
  Workflow: WorkflowCircle03Icon,
  X: Cancel01Icon,
  Zap: ZapIcon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: {
  name: IconName;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      className={className}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
