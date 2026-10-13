// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanDetails } from "./PlanDetails";

const harness = vi.hoisted(() => ({ call: vi.fn(), openThread: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: harness.call };
  return { useRpc: () => rpc };
});
vi.mock("./sidebar-context", () => ({ useSidebar: () => ({ openThread: harness.openThread }) }));
vi.mock("../hooks/useThreadQueue", () => ({ useThreadQueue: () => undefined }));

beforeEach(() => {
  harness.call.mockReset();
  harness.openThread.mockReset();
});
afterEach(cleanup);

describe("Plan details", () => {
  it("shows the current planning request and opens its thread without activating the row", async () => {
    harness.call.mockResolvedValue({ plan: { mode: "plan", prompt: "Inspect the sidebar\nThen propose the change", providerId: "codex" } });
    const rowClick = vi.fn();
    const rowPress = vi.fn();
    const rowRename = vi.fn();
    render(<div onClick={rowClick} onMouseDown={rowPress} onPointerDown={rowPress} onDoubleClick={rowRename}><PlanDetails threadId="t1" updatedAt={1} /></div>);
    expect(await screen.findByText(/Inspect the sidebar/)).toBeTruthy();
    expect(screen.getByText("Planning request")).toBeTruthy();
    expect(harness.call).toHaveBeenCalledWith("threads.plan", { threadId: "t1" });
    const open = screen.getByRole("button", { name: "Open thread" });
    fireEvent.pointerDown(open);
    fireEvent.mouseDown(open);
    fireEvent.click(open);
    fireEvent.doubleClick(open);
    expect(harness.openThread).toHaveBeenCalledExactlyOnceWith("t1", false);
    expect(rowClick).not.toHaveBeenCalled();
    expect(rowPress).not.toHaveBeenCalled();
    expect(rowRename).not.toHaveBeenCalled();
  });

  it.each([
    [null, "Plan mode is no longer active."],
    [{ mode: "plan", prompt: "  ", providerId: "codex" }, "Plan mode is active. No planning request text is available."],
  ])("explains absent plan text while retaining a working thread action", async (plan, message) => {
    harness.call.mockResolvedValue({ plan });
    render(<PlanDetails threadId="t1" updatedAt={1} />);
    expect(await screen.findByText(message)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(harness.openThread).toHaveBeenCalledWith("t1", false);
  });

  it("keeps the thread action available when loading fails", async () => {
    harness.call.mockRejectedValue(new Error("offline"));
    render(<PlanDetails threadId="t1" updatedAt={1} />);
    expect(await screen.findByText("Plan details are unavailable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(harness.openThread).toHaveBeenCalledWith("t1", false);
  });

  it("ignores a stale response after the thread changes", async () => {
    let resolveOld!: (value: unknown) => void;
    harness.call.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ plan: { mode: "plan", prompt: "Current request", providerId: "codex" } });
    const view = render(<PlanDetails threadId="old" updatedAt={1} />);
    expect(screen.getByRole("status").textContent).toBe("Loading plan…");
    view.rerender(<PlanDetails threadId="new" updatedAt={2} />);
    expect(await screen.findByText("Current request")).toBeTruthy();
    await act(async () => resolveOld({ plan: { mode: "plan", prompt: "Stale request", providerId: "codex" } }));
    expect(screen.queryByText("Stale request")).toBeNull();
    expect(screen.getByText("Current request")).toBeTruthy();
  });
});
