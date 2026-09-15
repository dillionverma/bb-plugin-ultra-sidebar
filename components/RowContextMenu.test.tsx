// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { RowContextMenu } from "./RowContextMenu";

const actions = vi.hoisted(() => ({
  workspaces: [{ id: "ws1", name: "Client work" }, { id: "ws2", name: "Personal" }],
  openThread: vi.fn(), openFolder: vi.fn(), openUrl: vi.fn(), moveTo: vi.fn(),
  clearItem: vi.fn(), nudge: vi.fn(), setStatus: vi.fn(), setSnoozed: vi.fn(),
  setPinned: vi.fn(), setRead: vi.fn(), archiveThread: vi.fn(), retryThread: vi.fn(), deleteThread: vi.fn(),
}));
vi.mock("./sidebar-context", () => ({ useSidebar: () => actions }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(parentThreadId: string | null = null) {
  const onBackgroundContextMenu = vi.fn();
  render(
    <div onContextMenu={onBackgroundContextMenu}>
      <RowContextMenu
        item={{ kind: "thread", refId: "t1" }}
        currentWorkspaceId="ws1"
        thread={{ id: "t1", parentThreadId, isPinned: false, isUnread: false, environment: { id: "env1" } } as PluginSidebarThread}
        manualStatus={null}
        onRename={vi.fn()}
      >
        <button>Thread</button>
      </RowContextMenu>
    </div>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Thread" }));
  return onBackgroundContextMenu;
}

async function openMoveMenu() {
  const move = await screen.findByRole("menuitem", { name: /^Move/ });
  move.focus();
  fireEvent.keyDown(move, { key: "ArrowRight" });
  return screen.findByRole("group", { name: "Workspace destination" });
}

describe("thread context menus", () => {
  it("keeps the thread menu scoped, with direct navigation and isolated destructive actions", async () => {
    const background = mount();
    const navigation = await screen.findByRole("group", { name: "Open thread" });
    expect(background).not.toHaveBeenCalled();
    expect(within(navigation).getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(within(navigation).getByRole("menuitem", { name: /Open in split/ }).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Move up/ })).toBeNull();
    const removal = screen.getByRole("group", { name: "Remove thread" });
    const deleteItem = within(removal).getByRole("menuitem", { name: "Delete" });
    expect(deleteItem.getAttribute("data-variant")).toBe("destructive");
    fireEvent.click(deleteItem);
    expect(actions.deleteThread).toHaveBeenCalledWith("t1");
    expect(actions.openThread).not.toHaveBeenCalled();
  });

  it("opens Move using the keyboard and keeps workspace destination actions intact", async () => {
    mount();
    const destinations = await openMoveMenu();
    expect(within(destinations).getByRole("menuitem", { name: "Client work" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(destinations).getByRole("menuitem", { name: "Personal" }));
    expect(actions.moveTo).toHaveBeenCalledWith({ kind: "thread", refId: "t1" }, "ws2");
  });

  it("keeps reordering inside Move and disables it for nested threads", async () => {
    mount();
    await openMoveMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Move up/ }));
    expect(actions.nudge).toHaveBeenCalledWith({ kind: "thread", refId: "t1" }, -1);
    cleanup();
    mount("parent");
    await openMoveMenu();
    expect(screen.getByRole("menuitem", { name: /^Move up/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /^Move down/ }).getAttribute("aria-disabled")).toBe("true");
  });
});
