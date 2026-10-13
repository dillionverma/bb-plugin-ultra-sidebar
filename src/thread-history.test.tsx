// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginAppBuilder,
  PluginCommandContext,
  PluginCommandRegistration,
} from "@get-bb/plugin-sdk/app";

beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
});

afterEach(() => {
  cleanup();
});

function pressMod(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

it("registers the history overlay and shortcut script beside the thread list", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.threadLists.map((list) => list.id)).toEqual(["workspaces"]);
  expect(app.appOverlays.map((overlay) => overlay.id)).toEqual(["thread-history"]);
  expect(app.contentScripts.map((script) => script.id)).toEqual([
    "thread-history-shortcuts",
  ]);
});

it("moves back and forward through opened threads with Mod+[ and Mod+]", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0]!;

  const first = renderSlot(overlay, {}, { context: { threadId: "thr_a" } });
  first.lifecycle.unmount();
  const second = renderSlot(overlay, {}, { context: { threadId: "thr_b" } });
  const scripts = await mountPluginContentScripts(app, {
    pluginId: "workspace-sidebar",
  });

  expect(pressMod("[").defaultPrevented).toBe(true);
  expect(second.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_a" },
  ]);

  expect(pressMod("[").defaultPrevented).toBe(false);
  expect(second.inspection.navigateCalls).toHaveLength(1);

  expect(pressMod("]").defaultPrevented).toBe(true);
  expect(second.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_a" },
    { method: "toThread", threadId: "thr_b" },
  ]);
  expect(pressMod("]").defaultPrevented).toBe(false);

  await scripts.lifecycle.dispose();
  expect(pressMod("[").defaultPrevented).toBe(false);
  expect(second.inspection.navigateCalls).toHaveLength(2);
});

it("does nothing before the overlay has mounted", async () => {
  const app = await loadPluginApp(() => import("./app"));
  window.sessionStorage.setItem(
    "bb-workspace-sidebar:thread-history:v1",
    JSON.stringify({ entries: ["thr_a", "thr_b"], index: 1 }),
  );
  const scripts = await mountPluginContentScripts(app, {
    pluginId: "workspace-sidebar",
  });

  expect(pressMod("[").defaultPrevented).toBe(false);
  expect(
    JSON.parse(window.sessionStorage.getItem("bb-workspace-sidebar:thread-history:v1")!),
  ).toEqual({ entries: ["thr_a", "thr_b"], index: 1 });

  await scripts.lifecycle.dispose();
});

it("registers Back and Forward as palette commands that follow the history", async () => {
  // The IDs are what users have bound shortcuts to, so they stay.
  const commands: PluginCommandRegistration[] = [];
  const builder = {
    slots: new Proxy({}, { get: () => () => undefined }),
    contentScripts: { register: () => undefined },
    commands: { register: (command: PluginCommandRegistration) => { commands.push(command); } },
  } as unknown as PluginAppBuilder;
  const { default: definition } = await import("./app");
  definition.setup(builder);
  expect(commands.map((command) => command.id)).toEqual(["thread-back", "thread-forward"]);
  const [back, forward] = commands as [PluginCommandRegistration, PluginCommandRegistration];
  const context = { threadId: null, projectId: null } as PluginCommandContext;
  expect(back.isAvailable?.(context)).toBe(false);
  expect(forward.isAvailable?.(context)).toBe(false);

  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0]!;
  const first = renderSlot(overlay, {}, { context: { threadId: "thr_a" } });
  first.lifecycle.unmount();
  const second = renderSlot(overlay, {}, { context: { threadId: "thr_b" } });
  expect(back.isAvailable?.(context)).toBe(true);
  expect(forward.isAvailable?.(context)).toBe(false);

  await back.run(context);
  expect(second.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_a" },
  ]);
  expect(back.isAvailable?.(context)).toBe(false);
  expect(forward.isAvailable?.(context)).toBe(true);
});
