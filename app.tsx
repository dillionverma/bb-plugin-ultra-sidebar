// bb-plugin-workspace-sidebar — frontend entry.
//
// Replaces bb's sidebar thread list with collapsible workspaces: user-defined
// containers that group projects and threads, with subagent threads nested
// under the thread that spawned them.
//
// experimental_threadList is bb's one EXCLUSIVE slot — only one list can fill
// the sidebar's scroll area. If another plugin also registers one, the first
// in slot order wins and the user picks between them under
// Settings -> Appearance -> Sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./components/sidebar-polish.css";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "workspaces",
    title: "Ultra Sidebar",
    description:
      "Group projects and threads into collapsible workspaces, with subagents nested under their parent thread.",
    component: WorkspaceSidebar,
  });
});
