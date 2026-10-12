// bb-plugin-ultra-sidebar — frontend entry.
//
// Replaces bb's sidebar thread list with collapsible sections: a pinned list
// on top, then the threads by project or by status, with subagent threads
// nested under the thread that spawned them. Mod+[ and Mod+] move back and
// forward through the threads opened in this window.
//
// experimental_threadList is bb's one EXCLUSIVE slot — only one list can fill
// the sidebar's scroll area. If another plugin also registers one, the first
// in slot order wins and the user picks between them under
// Settings -> Appearance -> Sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./components/sidebar-polish.css";
import {
  canStepThreadHistory,
  stepThreadHistory,
  ThreadHistoryBridge,
} from "@/components/ThreadHistoryBridge";
import { UltraSidebar } from "@/components/UltraSidebar";
import {
  isMacPlatform,
  threadHistoryShortcutOffset,
} from "@/lib/thread-history-shortcut";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    // Unchanged on purpose: the sidebar a client has chosen is stored by
    // this id, and renaming it would silently switch every install back to
    // bb's own list.
    id: "workspaces",
    title: "Ultra Sidebar",
    description:
      "Group threads by project or status, pin the ones that matter to the top, with subagents nested under their parent thread.",
    component: UltraSidebar,
  });

  // Visits are recorded from the active thread, not from sidebar clicks, so
  // threads opened from Cmd+K, links, or notifications count too.
  app.slots.experimental_appOverlay({
    id: "thread-history",
    component: ThreadHistoryBridge,
  });

  app.contentScripts.register({
    id: "thread-history-shortcuts",
    mount({ signal }) {
      const isMac = isMacPlatform();
      const onKeyDown = (event: KeyboardEvent) => {
        const offset = threadHistoryShortcutOffset(event, isMac);
        if (offset === null || !stepThreadHistory(offset)) return;
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener("keydown", onKeyDown, { capture: true, signal });
    },
  });

  app.slots.commandPaletteAction({
    id: "thread-back",
    title: "Back to previous thread",
    isAvailable: () => canStepThreadHistory(-1),
    run: () => {
      stepThreadHistory(-1);
    },
  });

  app.slots.commandPaletteAction({
    id: "thread-forward",
    title: "Forward to next thread",
    isAvailable: () => canStepThreadHistory(1),
    run: () => {
      stepThreadHistory(1);
    },
  });
});
