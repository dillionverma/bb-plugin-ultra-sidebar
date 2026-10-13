import {
  createContext,
  useContext,
} from "react";

import { useMediaQuery } from "./use-media-query.js";

const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

const CompactViewportOverrideContext = createContext<boolean | null>(null);

export function useIsCompactViewport(): boolean {
  const override = useContext(CompactViewportOverrideContext);
  const isCompactViewport = useMediaQuery(COMPACT_VIEWPORT_QUERY);
  if (override !== null) {
    return override;
  }
  return isCompactViewport;
}
