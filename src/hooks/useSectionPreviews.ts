import { useCallback, useState } from "react";
import { SECTION_PREVIEW_SIZE } from "../lib/section-preview";

export function useSectionPreviews(scope: string) {
  const [state, setState] = useState({ scope, limits: new Map<string, number>() });
  if (state.scope !== scope) setState({ scope, limits: new Map() });
  const limits = state.scope === scope ? state.limits : new Map<string, number>();

  const loadMore = useCallback((sectionId: string) => {
    setState(current => {
      const next = new Map(current.scope === scope ? current.limits : []);
      next.set(sectionId, (next.get(sectionId) ?? SECTION_PREVIEW_SIZE) + SECTION_PREVIEW_SIZE);
      return { scope, limits: next };
    });
  }, [scope]);

  const reset = useCallback((sectionId: string) => {
    setState(current => {
      if (!current.limits.has(sectionId)) return current;
      const next = new Map(current.limits);
      next.delete(sectionId);
      return { ...current, limits: next };
    });
  }, []);

  const resetAll = useCallback(() => setState(current => ({ ...current, limits: new Map() })), []);
  return { limits, loadMore, reset, resetAll };
}
