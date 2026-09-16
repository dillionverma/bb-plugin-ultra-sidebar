// bb-plugin-ultra-sidebar — frontend entry.
//
// Replaces bb's sidebar thread list with collapsible sections: a pinned list
// on top, then the threads by project or by status, with subagent threads
// nested under the thread that spawned them.
//
// experimental_threadList is bb's one EXCLUSIVE slot — only one list can fill
// the sidebar's scroll area. If another plugin also registers one, the first
// in slot order wins and the user picks between them under
// Settings -> Appearance -> Sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./components/sidebar-polish.css";
import { UltraSidebar } from "@/components/UltraSidebar";

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
});
