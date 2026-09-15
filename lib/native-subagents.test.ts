import { describe, expect, it } from "vitest";
import { agentLabel } from "./native-subagents";

describe("agentLabel", () => {
  it("reads a provider's path-shaped name as a task", () => {
    expect(agentLabel("/root/sidebar_ux_review")).toBe("Sidebar ux review");
  });

  it("leaves a name that already reads as one alone, bar its first letter", () => {
    expect(agentLabel("review the diff")).toBe("Review the diff");
  });

  it("falls back when there is nothing to show", () => {
    expect(agentLabel("///")).toBe("Subagent");
    expect(agentLabel("  ")).toBe("Subagent");
  });
});
