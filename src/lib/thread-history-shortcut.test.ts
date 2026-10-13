import { describe, expect, it } from "vitest";
import { isMacPlatform, threadHistoryShortcutOffset } from "./thread-history-shortcut";

function key(overrides: Partial<Parameters<typeof threadHistoryShortcutOffset>[0]>) {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("thread history shortcut", () => {
  it("matches Cmd+[ and Cmd+] on macOS", () => {
    expect(threadHistoryShortcutOffset(key({ key: "[", metaKey: true }), true)).toBe(-1);
    expect(threadHistoryShortcutOffset(key({ key: "]", metaKey: true }), true)).toBe(1);
    expect(
      threadHistoryShortcutOffset(key({ key: "Dead", code: "BracketLeft", metaKey: true }), true),
    ).toBe(-1);
  });

  it("matches Ctrl+[ and Ctrl+] elsewhere", () => {
    expect(threadHistoryShortcutOffset(key({ key: "[", ctrlKey: true }), false)).toBe(-1);
    expect(threadHistoryShortcutOffset(key({ key: "]", ctrlKey: true }), false)).toBe(1);
    expect(threadHistoryShortcutOffset(key({ key: "[", metaKey: true }), false)).toBeNull();
  });

  it("ignores extra modifiers, the wrong modifier, and other keys", () => {
    expect(threadHistoryShortcutOffset(key({ key: "{", metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(threadHistoryShortcutOffset(key({ key: "[", metaKey: true, altKey: true }), true)).toBeNull();
    expect(threadHistoryShortcutOffset(key({ key: "[", metaKey: true, ctrlKey: true }), true)).toBeNull();
    expect(threadHistoryShortcutOffset(key({ key: "[", ctrlKey: true }), true)).toBeNull();
    expect(threadHistoryShortcutOffset(key({ key: "[" }), true)).toBeNull();
    expect(threadHistoryShortcutOffset(key({ key: "k", metaKey: true }), true)).toBeNull();
  });

  it("detects macOS from the navigator platform", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "", userAgent: "Mozilla (iPhone)" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform({})).toBe(false);
  });
});
