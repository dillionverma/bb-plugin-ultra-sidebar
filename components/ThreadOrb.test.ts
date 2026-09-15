import { describe, expect, it } from "vitest";
import { agentOrb } from "./ThreadOrb";

function status(
  indicator: string,
  overrides: { hasPendingInteraction?: boolean; indicatorLabel?: string | null } = {},
) {
  return {
    indicator: indicator as never,
    indicatorLabel: overrides.indicatorLabel ?? null,
    hasPendingInteraction: overrides.hasPendingInteraction ?? false,
  };
}

describe("agentOrb", () => {
  it("gives each live indicator its own verb", () => {
    expect(agentOrb(status("runtime"))?.state).toBe("working");
    expect(agentOrb(status("working-draft"))?.state).toBe("working");
    expect(agentOrb(status("background-agent"))?.state).toBe("connecting");
    expect(agentOrb(status("background-command"))?.state).toBe("shaping");
    expect(agentOrb(status("workflow"))?.state).toBe("weaving");
    expect(agentOrb(status("plan-mode"))?.state).toBe("composing");
    expect(agentOrb(status("goal"))?.state).toBe("solving");
    expect(agentOrb(status("waiting-for-input"))?.state).toBe("listening");
  });

  it("listens whenever the thread is blocked on the person, whatever else it is doing", () => {
    expect(agentOrb(status("runtime", { hasPendingInteraction: true }))?.state).toBe("listening");
  });

  it("has no orb for a thread at rest, so the ring stays", () => {
    expect(agentOrb(status("none"))).toBeNull();
    expect(agentOrb(status("unread-success"))).toBeNull();
    expect(agentOrb(status("unread-error"))).toBeNull();
    expect(agentOrb(status("draft"))).toBeNull();
    expect(agentOrb(status("some-future-kind"))).toBeNull();
  });

  it("prefers bb's own accessible label", () => {
    expect(agentOrb(status("runtime", { indicatorLabel: "Thread working" }))?.label).toBe("Thread working");
    expect(agentOrb(status("runtime"))?.label).toBe("The agent is running");
  });
});
