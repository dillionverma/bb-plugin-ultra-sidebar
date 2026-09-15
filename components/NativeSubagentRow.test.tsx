// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NativeSubagentRow } from "./NativeSubagentRow";
import type { NativeSubagent } from "@/lib/native-subagents";

afterEach(cleanup);

function agent(overrides: Partial<NativeSubagent> = {}): NativeSubagent {
  return {
    id: "agent-1",
    label: "Explore the repo",
    status: "pending",
    startedAt: 10,
    depth: 0,
    ...overrides,
  };
}

describe("NativeSubagentRow", () => {
  it("names the agent and says how it ended", () => {
    render(<NativeSubagentRow agent={agent({ status: "error" })} depth={1} />);
    expect(screen.getByText("Explore the repo")).toBeTruthy();
    expect(screen.getByText("Subagent failed")).toBeTruthy();
  });

  it("reads a provider's path-shaped name as a task, keeping the raw one", () => {
    render(
      <NativeSubagentRow agent={agent({ label: "/root/ux_review" })} depth={0} />,
    );
    expect(screen.getByText("Ux review").closest("[title]")?.getAttribute("title")).toBe(
      "/root/ux_review",
    );
  });

  it("indents one level deeper than its parent thread's row", () => {
    const { container } = render(
      <NativeSubagentRow agent={agent()} depth={2} />,
    );
    const row = container.querySelector(".bb-ws-row") as HTMLElement;
    expect(row.style.paddingLeft).toBe("34px");
  });

  it("keeps the indent of the deepest drawn level for deeper agents", () => {
    const { container } = render(
      <NativeSubagentRow agent={agent()} depth={9} />,
    );
    const row = container.querySelector(".bb-ws-row") as HTMLElement;
    expect(row.style.paddingLeft).toBe("48px");
  });
});
