// The agent's live state as a thinking-orbs animation.
//
// The Linear ring (StatusIcon) says where a thread stands; this says what the
// agent is doing right now. It only exists while the agent is in motion or
// waiting on the person, so a row at rest keeps the ring and the sidebar does
// not turn into a wall of animation. Keyed off bb's indicator, never the pull
// request: a PR with conflicts is a fact about the work, not about the agent.
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import type { OrbState } from "thinking-orbs";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

export interface AgentOrb {
  state: OrbState;
  label: string;
}

// bb adds indicator kinds over time; anything unknown gets no orb.
const BY_INDICATOR: Record<string, AgentOrb> = {
  "waiting-for-input": { state: "listening", label: "Waiting for your input" },
  runtime: { state: "working", label: "The agent is running" },
  "working-draft": { state: "working", label: "The agent is running" },
  "background-agent": { state: "connecting", label: "A background agent is running" },
  "background-command": { state: "shaping", label: "A background command is running" },
  workflow: { state: "weaving", label: "A workflow is running" },
  "plan-mode": { state: "composing", label: "In plan mode" },
  goal: { state: "solving", label: "Working toward a goal" },
};

/** Null when the agent is at rest, so the caller can fall back to the ring. */
export function agentOrb(
  thread: Pick<PluginSidebarThread, "indicator" | "indicatorLabel" | "hasPendingInteraction">,
): AgentOrb | null {
  if (thread.hasPendingInteraction) {
    return { state: "listening", label: thread.indicatorLabel ?? "Waiting on an approval or an answer" };
  }
  const orb = BY_INDICATOR[thread.indicator];
  if (orb === undefined) return null;
  return { state: orb.state, label: thread.indicatorLabel ?? orb.label };
}

export function ThreadOrb({ orb, className }: { orb: AgentOrb; className?: string }) {
  return (
    <span
      data-agent-orb={orb.state}
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}
    >
      {/* The 20px preset is the inline-text tuning; scaled to the ring's 14px
          slot so the title column does not shift when a row starts working.
          theme="auto" follows bb's `dark` class on <html>. */}
      <ThinkingOrb
        state={orb.state}
        size={20}
        theme="auto"
        aria-label={orb.label}
        className="block origin-center"
        style={{ transform: "scale(0.8)" }}
      />
    </span>
  );
}
