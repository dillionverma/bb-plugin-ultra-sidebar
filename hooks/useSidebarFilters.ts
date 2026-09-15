import { useCallback, useEffect, useState } from "react";
import { PROJECT_FILTER_KEY } from "./useViewState";

export const SIDEBAR_FILTERS_KEY = "bb-workspace-sidebar:filters:v1";

interface SidebarFilters {
  workspaceId: string | null;
  projectIds: string[];
}

const ALL: SidebarFilters = { workspaceId: null, projectIds: [] };

// Validated by hand: pulling zod into the frontend bundle costs ~450 KB, which
// delays the sidebar replacing bb's list on every load.
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseFilters(value: unknown): SidebarFilters | null {
  if (typeof value !== "object" || value === null) return null;
  const { workspaceId, projectIds } = value as Record<string, unknown>;
  if (workspaceId !== null && !isNonEmptyString(workspaceId)) return null;
  if (!Array.isArray(projectIds) || !projectIds.every(isNonEmptyString)) return null;
  return { workspaceId, projectIds };
}

function readFilters(): SidebarFilters {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_FILTERS_KEY);
    if (raw !== null) return parseFilters(JSON.parse(raw)) ?? ALL;
    const legacy = window.localStorage.getItem(PROJECT_FILTER_KEY);
    return legacy ? { workspaceId: null, projectIds: [legacy] } : ALL;
  } catch {
    return ALL;
  }
}

export function useSidebarFilters() {
  const [filters, setFilters] = useState(readFilters);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_FILTERS_KEY, JSON.stringify(filters));
    } catch {}
  }, [filters]);

  const setWorkspace = useCallback((workspaceId: string | null) => {
    setFilters({ workspaceId, projectIds: [] });
  }, []);

  const setProjects = useCallback((projectIds: readonly string[]) => {
    setFilters(current => ({ ...current, projectIds: [...new Set(projectIds)] }));
  }, []);

  const clear = useCallback(() => setFilters(ALL), []);

  return { ...filters, setWorkspace, setProjects, clear };
}
