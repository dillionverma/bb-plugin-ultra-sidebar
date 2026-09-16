// One stable bundle of handlers shared by every row.
//
// Rows are memoized on their thread object, which the host keeps identity-
// stable across updates. That only pays off if their props are stable too, so
// callbacks travel through context instead of being rebuilt inline per row.
import { createContext, useContext } from "react";
import type { experimental_useProviders } from "@get-bb/plugin-sdk/app";

/** The SDK does not export ProviderInfo by name; take it from the hook. */
export type ProviderInfo = ReturnType<
  typeof experimental_useProviders
>["providers"][number];
import type { ItemRef } from "../lib/types";
import type { RowDetails } from "../hooks/useViewState";
import type { EnvironmentLocation } from "../hooks/useEnvironmentLocations";
import type { ProjectArtwork } from "../hooks/useProjectArtwork";
import type { ManualStatus } from "../lib/status";

export interface SidebarContextValue {
  activeThreadId: string | null;
  /** Keep idle rows on one line and move metadata into their details. */
  compactRows: boolean;
  /** Which badges the line under a title shows. */
  rowDetails: RowDetails;
  /** The host's name for a project, or "" when it no longer reports one. */
  projectNameOf(projectId: string): string;
  /** A project's icon or logo, once found; null means the folder glyph. */
  artworkOf(projectId: string): ProjectArtwork | null;
  /** The checkout directory behind an environment, once it has been fetched. */
  locationOf(environmentId: string): EnvironmentLocation | null;
  /** Reveal an environment's folder in the file manager, when it is on this machine. */
  openFolder(environmentId: string): void;
  /** Open an http(s) URL the way this client prefers (system browser on desktop). */
  openUrl(url: string): void;

  openThread(threadId: string, split: boolean): void;
  /** Pin to the top of the sidebar, or release it back to its project. */
  setPinned(threadId: string, pinned: boolean): void;
  setRead(threadId: string, read: boolean): void;
  renameThread(threadId: string, title: string): void;
  archiveThread(threadId: string): void;
  /** Re-submit the turn that failed, the same as bb's own Retry. */
  retryThread(threadId: string): void;
  deleteThread(threadId: string): void;
  newThreadIn(projectId: string): void;

  /** Keyboard reorder: -1 moves earlier, 1 later, within the same section. */
  nudge(item: ItemRef, direction: -1 | 1): void;
  /** Hand this section's rows back to newest-first ordering. */
  resetOrder(sectionId: string): void;

  isSubtreeExpanded(threadId: string): boolean;
  toggleSubtree(threadId: string): void;
  /**
   * Open or close a subtree without reading its current state first. The
   * arrow keys need this: `toggle` would flip the wrong way whenever a row's
   * state changed between keystrokes.
   */
  setSubtreeExpanded(threadId: string, expanded: boolean): void;

  isSectionCollapsed(sectionId: string): boolean;
  toggleSection(sectionId: string): void;

  /** The bucket the person filed a thread in by hand, or null. */
  manualStatusOf(threadId: string): ManualStatus | null;
  /** File a thread in Backlog, Done or Canceled; null lets its facts decide. */
  setStatus(threadId: string, status: ManualStatus | null): void;
  /** Hide until a timestamp; null wakes it now. */
  setSnoozed(threadId: string, until: number | null): void;

  /**
   * The registered agent provider for an id, or null. The whole record, not
   * just the name: experimental_ProviderIcon renders from the object.
   */
  provider(providerId: string): ProviderInfo | null;

}

export const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (value === null) {
    throw new Error("Sidebar context is missing");
  }
  return value;
}
