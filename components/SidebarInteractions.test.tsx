// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { SidebarInteractions, useSidebarSelection } from "./SidebarInteractions";
import { UndoHistory } from "../lib/history";

const sidebar = vi.hoisted(() => ({
  setStatus: vi.fn(),
  setSnoozed: vi.fn(),
  openThread: vi.fn(),
}));
vi.mock("./sidebar-context", () => ({ useSidebar: () => sidebar }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Rows() {
  const [collapsed, setCollapsed] = useState(false);
  const selection = useSidebarSelection();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="scroll-area">
      <button onClick={selection.enter}>Start selecting</button>
      <button onClick={() => setCollapsed((value) => !value)}>Toggle group</button>
      <input aria-label="Rename workspace" />
      <div data-testid="blank-area">Empty space</div>
      {(collapsed ? ["parent"] : ["parent", "child", "other"]).map((id) => (
        <div key={id}>
          {selection.active && (
            <button role="checkbox" aria-checked={selection.selected.has(id)} aria-label={`Select ${id}`} onClick={() => selection.toggle(id)} />
          )}
          <a
            href={`#${id}`}
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={id}
            data-sidebar-bucket="in-progress"
            onClick={(event) => {
              event.preventDefault();
              if (!selection.click(id, event)) sidebar.openThread(id, false);
            }}
          >
            {id}
          </a>
        </div>
      ))}
    </div>
  );
}

function mount() {
  const callbacks = {
    onNewThread: vi.fn(),
    onNewWorkspace: vi.fn(),
    onCollapseAll: vi.fn(),
    onExpandAll: vi.fn(),
    onViewOptions: vi.fn(),
  };
  const slot = render(
    <>
      <button>Outside sidebar</button>
      <SidebarInteractions
        history={new UndoHistory(() => {}, () => {})}
        batch={(_label, action) => action()}
        threadIds={["parent", "child", "other"]}
        {...callbacks}
      >
        <Rows />
      </SidebarInteractions>
      <div data-bb-portaled-overlay="" data-testid="portal">An open sidebar sheet</div>
    </>,
  );
  const row = (id: string) => slot.container.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`)!;
  return { ...slot, row, callbacks };
}

describe("sidebar selection surface", () => {
  it("keeps collapsed selections explicit and applies actions only to selected threads", async () => {
    const slot = mount();
    fireEvent.click(slot.row("parent"), { ctrlKey: true });
    expect(slot.getByText("1 selected")).toBeTruthy();
    fireEvent.click(slot.row("child"));
    fireEvent.click(slot.getByText("Toggle group"));
    await slot.findByText("1 hidden");
    expect(slot.getByText("2 selected")).toBeTruthy();
    const toolbar = slot.getByRole("toolbar", { name: "Selected threads" });
    const footer = toolbar.parentElement!;
    expect(footer.parentElement).toBe(slot.getByLabelText("Sidebar threads"));
    expect(slot.getByTestId("scroll-area").contains(footer)).toBe(false);
    fireEvent.click(within(toolbar).getByRole("button", { name: "Mark done" }));
    expect(sidebar.setStatus.mock.calls).toEqual([["parent", "done"], ["child", "done"]]);
    expect(slot.queryByRole("toolbar", { name: "Selected threads" })).toBeNull();
    expect(slot.queryByRole("checkbox")).toBeNull();
    expect(sidebar.openThread).not.toHaveBeenCalled();
  });

  it("selects shown rows with the keyboard and leaves collapsed descendants unselected", async () => {
    const slot = mount();
    slot.row("parent").focus();
    fireEvent.keyDown(slot.row("parent"), { key: " " });
    expect(slot.getByText("1 selected")).toBeTruthy();
    fireEvent.keyDown(slot.row("parent"), { key: "ArrowDown", shiftKey: true });
    expect(slot.getByText("2 selected")).toBeTruthy();
    fireEvent.click(slot.getByText("Toggle group"));
    await slot.findByText("1 hidden");
    fireEvent.keyDown(slot.row("parent"), { key: "a", metaKey: true });
    expect(slot.getByText("1 selected")).toBeTruthy();
    expect(slot.queryByText("1 hidden")).toBeNull();
    fireEvent.keyDown(slot.row("parent"), { key: "Escape" });
    expect(slot.queryByRole("toolbar")).toBeNull();
  });

  it("dismisses on outside clicks and keeps selection while using portaled controls", () => {
    const slot = mount();
    fireEvent.click(slot.getByText("Start selecting"));
    fireEvent.click(slot.getByRole("checkbox", { name: "Select child" }));
    fireEvent.pointerDown(slot.getByTestId("portal"));
    expect(slot.getByText("1 selected")).toBeTruthy();
    fireEvent.pointerDown(slot.getByText("Outside sidebar"));
    expect(slot.queryByRole("toolbar")).toBeNull();
    expect(slot.queryByRole("checkbox")).toBeNull();
  });

  it("opens useful background actions without hijacking native input or row menus", async () => {
    const slot = mount();
    const input = slot.getByRole("textbox");
    const nativeInput = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(input, nativeInput);
    expect(nativeInput.defaultPrevented).toBe(false);
    expect(slot.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(slot.row("parent"));
    expect(slot.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(slot.getByTestId("blank-area"), { clientX: 40, clientY: 60 });
    const menu = await slot.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Collapse all" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "View options…" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New thread" }));
    expect(slot.callbacks.onNewThread).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(slot.queryByRole("menu")).toBeNull());
  });
});
