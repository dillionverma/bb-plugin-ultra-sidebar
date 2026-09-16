// Per-client view state: which sections are collapsed, which subagent
// subtrees are expanded. This is not worth a database round trip and it is
// reasonable for two windows to disagree, so it lives in localStorage.
//
// Every access is guarded. A throw inside a replaced thread list costs the
// user the whole sidebar, and localStorage throws for reasons that have
// nothing to do with us (private mode, quota, a disabled origin).
import { useCallback, useState } from "react";

const PREFIX = "bb-workspace-sidebar";

/** Versioned keys: a shape change becomes a new key, not a migration. */
export const COLLAPSED_SECTIONS_KEY = `${PREFIX}:collapsed-sections:v2`;
export const EXPANDED_SUBTREES_KEY = `${PREFIX}:expanded-subtrees:v1`;
export const ROW_DETAILS_KEY = `${PREFIX}:row-details:v1`;
export const COMPACT_ROWS_KEY = `${PREFIX}:compact-rows:v1`;
export const PROJECT_ICONS_KEY = `${PREFIX}:project-icons:v1`;
export const GROUP_BY_KEY = `${PREFIX}:group-by:v1`;
export const PROJECT_FILTER_KEY = `${PREFIX}:project-filter:v1`;

/**
 * Which facts the metadata line under a title shows. Each is its own switch
 * so the line can be pared down to the one or two things a user scans for.
 */
export interface RowDetails {
  project: boolean;
  branch: boolean;
  machine: boolean;
  model: boolean;
  pullRequest: boolean;
  agent: boolean;
}

export const ROW_DETAIL_KEYS: readonly (keyof RowDetails)[] = [
  "project",
  "branch",
  "machine",
  "model",
  "pullRequest",
  "agent",
];

export const DEFAULT_ROW_DETAILS: RowDetails = {
  project: true,
  branch: true,
  machine: true,
  model: true,
  pullRequest: true,
  agent: true,
};

function readDetails(key: string): RowDetails {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return DEFAULT_ROW_DETAILS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_ROW_DETAILS;
    const next = { ...DEFAULT_ROW_DETAILS };
    for (const detail of ROW_DETAIL_KEYS) {
      const value = (parsed as Record<string, unknown>)[detail];
      if (typeof value === "boolean") next[detail] = value;
    }
    return next;
  } catch {
    return DEFAULT_ROW_DETAILS;
  }
}

/** The per-row detail switches, persisted as one object. */
export function usePersistedDetails(
  key: string,
): [RowDetails, (detail: keyof RowDetails, on: boolean) => void] {
  const [value, setValue] = useState<RowDetails>(() => readDetails(key));
  const set = useCallback(
    (detail: keyof RowDetails, on: boolean) => {
      setValue((current) => {
        if (current[detail] === on) return current;
        const next = { ...current, [detail]: on };
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // See writeSet.
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

/** A persisted boolean, for view preferences with an on/off shape. */
export function usePersistedFlag(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === "true";
    } catch {
      return fallback;
    }
  });

  const commit = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // See writeSet: losing the preference is acceptable, throwing is not.
      }
      setValue(next);
    },
    [key],
  );

  return [value, commit];
}

function readSet(key: string): Set<string> {
  // Introduce the Done default once, preserving other collapsed sections.
  // Subsequent explicit expansion is saved under v2 and survives reloads.
  const fallback = () => key === COLLAPSED_SECTIONS_KEY
    ? new Set([...readSet(`${PREFIX}:collapsed-sections:v1`), "status:done"])
    : new Set<string>();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return fallback();
  }
}

function writeSet(key: string, value: Set<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // A full or unavailable store costs the user their collapse state on the
    // next reload. It must not cost them the sidebar.
  }
}

/** A persisted set of ids with a stable toggle. */
export function usePersistedSet(key: string): {
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  set: (id: string, member: boolean) => void;
  addAll: (ids: Iterable<string>) => void;
  replace: (ids: Iterable<string>) => void;
} {
  const [ids, setIds] = useState<Set<string>>(() => readSet(key));

  const commit = useCallback(
    (next: Set<string>) => {
      writeSet(key, next);
      setIds(next);
    },
    [key],
  );

  const has = useCallback((id: string) => ids.has(id), [ids]);

  const set = useCallback(
    (id: string, member: boolean) => {
      setIds((current) => {
        if (current.has(id) === member) return current;
        const next = new Set(current);
        if (member) next.add(id);
        else next.delete(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  // Adding an ancestor chain is one update and at most one write. Returning
  // `current` unchanged when nothing was added is what keeps an effect that
  // calls this on every host push from looping.
  const addAll = useCallback(
    (incoming: Iterable<string>) => {
      setIds((current) => {
        let next: Set<string> | null = null;
        for (const id of incoming) {
          if (current.has(id)) continue;
          next ??= new Set(current);
          next.add(id);
        }
        if (next === null) return current;
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  const replace = useCallback(
    (nextIds: Iterable<string>) => commit(new Set(nextIds)),
    [commit],
  );

  return { has, toggle, set, addAll, replace };
}

/** A persisted value from a closed set; an unrecognized stored value resets. */
export function usePersistedChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return allowed.includes(raw as T) ? (raw as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const commit = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // See writeSet.
      }
      setValue(next);
    },
    [key],
  );
  return [value, commit];
}

/** A persisted nullable string, for filters that are usually off. */
export function usePersistedValue(
  key: string,
): [string | null, (next: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const commit = useCallback(
    (next: string | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        // See writeSet.
      }
      setValue(next);
    },
    [key],
  );
  return [value, commit];
}
