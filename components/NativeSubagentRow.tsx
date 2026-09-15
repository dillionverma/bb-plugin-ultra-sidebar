// A subagent running inside its parent's own turn. It has no BB thread, so
// there is nothing to open, rename or drag: the row is a read-only line in
// the parent's tree, indented like a child thread so the two read as one
// list. A running agent shimmers, the same signal live titles use.
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MAX_RENDER_DEPTH } from "@/lib/resolve";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { agentLabel, type NativeSubagent } from "@/lib/native-subagents";

const INDENT_PX = 14;

const LOOK: Record<
  NativeSubagent["status"],
  { icon: IconName; tone: string; label: string }
> = {
  pending: { icon: "Bot", tone: "text-foreground/70", label: "running" },
  completed: { icon: "Check", tone: "text-muted-foreground/70", label: "done" },
  error: { icon: "AlertCircle", tone: "text-destructive", label: "failed" },
  interrupted: {
    icon: "CircleX",
    tone: "text-muted-foreground/70",
    label: "stopped",
  },
};

export function NativeSubagentRow({
  agent,
  depth,
}: {
  agent: NativeSubagent;
  /** The depth of the row, in parent-thread terms. */
  depth: number;
}) {
  const look = LOOK[agent.status];
  const running = agent.status === "pending";
  const label = agentLabel(agent.label);
  return (
    <div
      className="bb-ws-row flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-muted-foreground"
      style={{
        paddingLeft: `${6 + Math.min(depth, MAX_RENDER_DEPTH) * INDENT_PX}px`,
      }}
    >
      {/* Where a thread row keeps its chevron: nothing nests under an agent. */}
      <span aria-hidden className="w-4 shrink-0" />
      <Icon
        name={look.icon}
        aria-hidden
        className={cn("size-3.5 shrink-0", look.tone)}
      />
      <span className="min-w-0 flex-1 truncate" title={agent.label}>
        {running ? (
          <TextShimmer>{label}</TextShimmer>
        ) : (
          <span className={agent.status === "error" ? "text-destructive" : ""}>
            {label}
          </span>
        )}
      </span>
      {/* The status is carried by the glyph; keep it for screen readers. */}
      <span className="sr-only">{`Subagent ${look.label}`}</span>
    </div>
  );
}
