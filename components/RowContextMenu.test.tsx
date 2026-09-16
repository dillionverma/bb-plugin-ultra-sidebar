// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { RowContextMenu, SectionContextMenu } from "./RowContextMenu";
import type { Section } from "@/lib/sections";

const actions = vi.hoisted(() => ({
  openThread: vi.fn(), openFolder: vi.fn(), openUrl: vi.fn(),
  nudge: vi.fn(), resetOrder: vi.fn(), setStatus: vi.fn(), setSnoozed: vi.fn(),
  setPinned: vi.fn(), setRead: vi.fn(), archiveThread: vi.fn(), retryThread: vi.fn(),
  deleteThread: vi.fn(), newThreadIn: vi.fn(),
}));
vi.mock("./sidebar-context", () => ({ useSidebar: () => actions }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(
  parentThreadId: string | null = null,
  overrides: Partial<PluginSidebarThread> = {},
) {
  const onBackgroundContextMenu = vi.fn();
  render(
    <div onContextMenu={onBackgroundContextMenu}>
      <RowContextMenu
        item={{ kind: "thread", refId: "t1" }}
        thread={{ id: "t1", parentThreadId, isPinned: false, isUnread: false, environment: { id: "env1" }, ...overrides } as PluginSidebarThread}
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

async function openOrderMenu() {
  const order = await screen.findByRole("menuitem", { name: /^Order/ });
  order.focus();
  fireEvent.keyDown(order, { key: "ArrowRight" });
  return screen.findByRole("group", { name: "Order in section" });
}

function mountSection(section: Partial<Section>) {
  render(
    <SectionContextMenu
      section={{
        id: "project:p1",
        name: "Alpha",
        kind: "project",
        projectId: "p1",
        isPersonal: false,
        bucket: null,
        roots: [],
        threadCount: 0,
        showProject: false,
        manual: false,
        ...section,
      } as Section}
    >
      <button>Heading</button>
    </SectionContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Heading" }));
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

  it("offers the pin beside the other organizing actions, and says which way it goes", async () => {
    mount();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pin to top/ }));
    expect(actions.setPinned).toHaveBeenCalledWith("t1", true);
    cleanup();
    mount(null, { isPinned: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Unpin from top/ }));
    expect(actions.setPinned).toHaveBeenCalledWith("t1", false);
  });

  it("does not offer the pin on a subagent, which the Pinned list cannot hold", async () => {
    mount("parent");
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /Pin to top/ })).toBeNull();
  });

  it("reorders from the keyboard, and disables it for nested threads", async () => {
    mount();
    await openOrderMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Move up/ }));
    expect(actions.nudge).toHaveBeenCalledWith({ kind: "thread", refId: "t1" }, -1);
    cleanup();
    mount("parent");
    await openOrderMenu();
    expect(screen.getByRole("menuitem", { name: /^Move up/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /^Move down/ }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("section context menu", () => {
  it("starts a thread in the project it names, and orders it against the others", async () => {
    mountSection({});
    fireEvent.click(await screen.findByRole("menuitem", { name: /New thread here/ }));
    expect(actions.newThreadIn).toHaveBeenCalledWith("p1");
    cleanup();
    mountSection({});
    fireEvent.click(await screen.findByRole("menuitem", { name: /Move project up/ }));
    expect(actions.nudge).toHaveBeenCalledWith({ kind: "project", refId: "p1" }, -1);
  });

  it("offers to undo a hand-picked order only once there is one", async () => {
    mountSection({});
    expect(screen.queryByRole("menuitem", { name: /Sort by most recent/ })).toBeNull();
    cleanup();
    mountSection({ manual: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Sort by most recent/ }));
    expect(actions.resetOrder).toHaveBeenCalledWith("project:p1");
  });

  it("has nothing to start or reorder on a status bucket", async () => {
    mountSection({ id: "status:done", name: "Done", kind: "status", projectId: null, bucket: "done" });
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /New thread here/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Move project up/ })).toBeNull();
  });
});
