// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadModes } from "./ThreadModes";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("./ui/hooks/use-compact-viewport", () => ({ useIsCompactViewport: () => viewport.compact }));
vi.mock("../lib/portal-scope", () => ({ usePortalScopeProps: () => ({}) }));
vi.mock("../hooks/useThreadQueue", () => ({ useThreadQueue: () => undefined }));
afterEach(cleanup);

const thread = { id: "planning", title: "Plan upgrade", indicator: "plan-mode", activity: { planMode: 1, goals: 0 } } as PluginSidebarThread;

describe("mode detail triggers", () => {
  it.each([false, true])("opens and dismisses Plan without activating its parent row, mobile=%s", async mobile => {
    viewport.compact = mobile;
    const openRow = vi.fn();
    const openThread = vi.fn();
    const onOpen = vi.fn();
    render(<a href="#" onClick={openRow} onDoubleClick={openRow}>
      <ThreadModes thread={thread} compact details={<button type="button" onClick={openThread}>Open thread</button>} onDetailsOpenChange={onOpen}>Alpha</ThreadModes>
    </a>);
    const trigger = screen.getByRole("button", { name: "Plan mode: details for Plan upgrade" });
    fireEvent.click(trigger);
    const action = await screen.findByRole("button", { name: "Open thread" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onOpen).toHaveBeenLastCalledWith(true);
    fireEvent.click(action);
    fireEvent.doubleClick(action);
    expect(openThread).toHaveBeenCalledOnce();
    expect(openRow).not.toHaveBeenCalled();
    fireEvent.keyDown(action, { key: "Escape" });
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    expect(onOpen).toHaveBeenLastCalledWith(false);
  });
});
