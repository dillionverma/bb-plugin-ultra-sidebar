// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MachineIndicator } from "./MachineIndicator";
import { TooltipProvider } from "./ui/tooltip";
import { guardHandle } from "../hooks/useSidebarDnd";

vi.mock("../lib/portal-scope", () => ({ usePortalScopeProps: () => ({}) }));
afterEach(cleanup);

it.each(["mac-mini", "mbp"])("shows %s on hover without click, press or focus activation", async name => {
  const openRow = vi.fn();
  const dragRow = vi.fn();
  render(<TooltipProvider delayDuration={0}>
    <a {...guardHandle({ onTouchStart: dragRow })} href="#" onClick={openRow} onDoubleClick={openRow} onPointerDown={openRow}>
      <MachineIndicator name={name} />
    </a>
  </TooltipProvider>);
  const marker = screen.getByLabelText(`Machine: ${name}`);
  expect(marker.tagName).toBe("SPAN");
  expect(marker.hasAttribute("tabindex")).toBe(false);
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.pointerDown(marker);
  fireEvent.click(marker);
  fireEvent.doubleClick(marker);
  fireEvent.touchStart(marker);
  expect(openRow).not.toHaveBeenCalled();
  expect(dragRow).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.pointerMove(marker, { pointerType: "mouse" });
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", `Machine · ${name}`);
});
