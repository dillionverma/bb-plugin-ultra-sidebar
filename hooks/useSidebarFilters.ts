import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PROJECT_FILTER_KEY } from "./useViewState";

export const SIDEBAR_FILTERS_KEY = "bb-workspace-sidebar:filters:v1";

const filtersSchema = z.object({
  workspaceId: z.string().min(1).nullable(),
  projectIds: z.array(z.string().min(1)),
});

type SidebarFilters = z.infer<typeof filtersSchema>;

const ALL: SidebarFilters = { workspaceId: null, projectIds: [] };

function readFilters(): SidebarFilters {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_FILTERS_KEY);
    if (raw !== null) {
      const result = filtersSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : ALL;
    }
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
