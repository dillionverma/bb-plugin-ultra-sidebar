// The stack of pull requests a thread's branch belongs to, as the PR Stacks
// plugin (bb-pr-stacks) infers it from the GitHub CLI.
//
// bb has no cross-plugin RPC, so this goes straight to that plugin's RPC
// endpoint, the same POST the SDK client makes for our own methods. When the
// plugin is not installed the endpoint 404s and the card simply has no stack
// section; nothing here is an error the user can act on from a hover card.
import { useEffect, useState } from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const STACK_ENDPOINT =
  "/api/v1/plugins/bb-pr-stacks/rpc/stack_for_thread";

export type StackCheckState = "passing" | "failing" | "pending" | "none";

export interface StackPullRequest {
  number: number;
  title: string;
  headRefName: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  url: string;
  checks: StackCheckState;
}

export interface StackNode {
  pullRequest: StackPullRequest;
  children: StackNode[];
}

export interface PullRequestStackData {
  repo: string;
  currentBranch: string;
  stack: StackNode;
}

/**
 * Read a stack out of the RPC envelope (`{ ok, result }`). Anything but a
 * stack — a branch with no PR, a checkout without GitHub, `gh` missing — is
 * null: those outcomes are for the thread header's own control, not this card.
 */
export function parseStackResponse(body: unknown): PullRequestStackData | null {
  if (typeof body !== "object" || body === null) return null;
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const candidate = result as {
    status?: unknown;
    repo?: unknown;
    currentBranch?: unknown;
    stack?: unknown;
  };
  if (
    candidate.status !== "ok" ||
    typeof candidate.repo !== "string" ||
    typeof candidate.currentBranch !== "string" ||
    typeof candidate.stack !== "object" ||
    candidate.stack === null
  ) {
    return null;
  }
  return {
    repo: candidate.repo,
    currentBranch: candidate.currentBranch,
    stack: candidate.stack as StackNode,
  };
}

export interface FlatStackEntry {
  pullRequest: StackPullRequest;
  depth: number;
}

/** Depth-first, parent before children: the order a nested list renders in. */
export function flattenStack(node: StackNode, depth = 0): FlatStackEntry[] {
  return [
    { pullRequest: node.pullRequest, depth },
    ...node.children.flatMap((child) => flattenStack(child, depth + 1)),
  ];
}

export function formatStackState(pullRequest: StackPullRequest): string {
  return pullRequest.isDraft && pullRequest.state === "open"
    ? "draft"
    : pullRequest.state;
}

const CHECKS_TEXT: Record<StackCheckState, string> = {
  passing: "checks passing",
  failing: "checks failing",
  pending: "checks pending",
  none: "no checks",
};

/** How long a fetched stack is reused before the card asks again. */
const CACHE_MS = 60_000;

const cache = new Map<
  string,
  { fetchedAt: number; data: PullRequestStackData | null }
>();
const inFlight = new Map<string, Promise<PullRequestStackData | null>>();

async function fetchStack(threadId: string): Promise<PullRequestStackData | null> {
  try {
    const response = await fetch(STACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId }),
    });
    if (!response.ok) return null;
    return parseStackResponse(await response.json());
  } catch {
    return null;
  }
}

function isFresh(threadId: string): boolean {
  const cached = cache.get(threadId);
  return cached !== undefined && Date.now() - cached.fetchedAt < CACHE_MS;
}

/** One request per thread at a time; everyone waiting gets the same answer. */
function loadStack(threadId: string): Promise<PullRequestStackData | null> {
  const pending = inFlight.get(threadId);
  if (pending !== undefined) return pending;
  const next = fetchStack(threadId)
    .then((data) => {
      cache.set(threadId, { fetchedAt: Date.now(), data });
      return data;
    })
    .finally(() => {
      inFlight.delete(threadId);
    });
  inFlight.set(threadId, next);
  return next;
}

/**
 * Start fetching before the card is needed. The card opens 700ms after the
 * pointer settles on a row; calling this as the pointer arrives spends that
 * wait on the request, so the card usually opens with the stack already in it.
 */
export function prefetchPullRequestStack(threadId: string): void {
  if (isFresh(threadId)) return;
  void loadStack(threadId);
}

/**
 * The stack for a thread, fetched when the caller mounts. The hover card only
 * mounts its content while open, so a request happens when someone actually
 * looks at a thread, and a repeat look within a minute costs nothing.
 */
export function usePullRequestStack(threadId: string): {
  isLoading: boolean;
  data: PullRequestStackData | null;
} {
  const cached = cache.get(threadId);
  const fresh = isFresh(threadId);
  const [state, setState] = useState<{
    threadId: string;
    isLoading: boolean;
    data: PullRequestStackData | null;
  }>({
    threadId,
    isLoading: !fresh,
    data: cached?.data ?? null,
  });

  useEffect(() => {
    if (fresh) return;
    let cancelled = false;
    void loadStack(threadId).then((data) => {
      if (!cancelled) setState({ threadId, isLoading: false, data });
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, fresh]);

  // A card re-used for another thread must not show the previous one's stack
  // while the new request is in flight.
  if (state.threadId !== threadId) {
    return { isLoading: !fresh, data: fresh ? (cached?.data ?? null) : null };
  }
  return { isLoading: state.isLoading, data: state.data };
}

/**
 * How a PR row links out. The card passes bb's `UrlLink`, which the desktop
 * app routes to the system browser; a plain anchor is the default so the list
 * renders outside a plugin slot, as in tests.
 */
export type StackLink = ComponentType<
  { href: string } & Omit<ComponentPropsWithoutRef<"a">, "href">
>;

const PlainLink: StackLink = ({ href, children, ...rest }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
    {children}
  </a>
);

/** The glyph and colour GitHub itself uses for each PR state. */
const STATE_GLYPH: Record<string, { icon: string; className: string; label: string }> = {
  open: { icon: "GitPullRequest", className: "text-emerald-500", label: "Open" },
  draft: { icon: "GitPullRequestDraft", className: "text-muted-foreground", label: "Draft" },
  merged: { icon: "GitMerge", className: "text-violet-500", label: "Merged" },
  closed: { icon: "GitPullRequestClosed", className: "text-destructive", label: "Closed" },
};

/** Only a check result that needs a look earns a word on the row. */
const CHECKS_FLAG: Partial<Record<StackCheckState, { text: string; className: string }>> = {
  failing: { text: "failing", className: "text-destructive" },
  pending: { text: "pending", className: "text-amber-500" },
};

/**
 * The stack as an indented chain of links, after t3code's card: a state glyph
 * per PR, the number muted, the title carrying the row, and a `stack · N`
 * badge on the bottom PR. The thread's own PR is the emphasised row.
 */
export function StackList({
  data,
  Link = PlainLink,
  className,
}: {
  data: PullRequestStackData;
  Link?: StackLink;
  className?: string;
}) {
  const entries = flattenStack(data.stack);
  return (
    <ul className={cn("flex flex-col", className)} aria-label="Pull request stack">
      {entries.map(({ pullRequest, depth }) => {
        const isCurrent = pullRequest.headRefName === data.currentBranch;
        const state = formatStackState(pullRequest);
        const glyph = STATE_GLYPH[state] ?? STATE_GLYPH.open!;
        const checks = CHECKS_FLAG[pullRequest.checks];
        return (
          <li key={pullRequest.number} aria-current={isCurrent ? "true" : undefined}>
            <Link
              href={pullRequest.url}
              title={`#${pullRequest.number} ${pullRequest.title} · ${glyph.label.toLowerCase()} · ${CHECKS_TEXT[pullRequest.checks]}`}
              style={{ paddingLeft: `${4 + depth * 14}px` }}
              className={cn(
                "-mx-1 flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 text-xs transition-colors hover:bg-accent",
                isCurrent ? "text-foreground" : "text-foreground/80 hover:text-foreground",
              )}
            >
              <Icon
                name={glyph.icon}
                aria-hidden
                className={cn("size-3.5 shrink-0", glyph.className)}
              />
              <span className="sr-only">{glyph.label} pull request </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                #{pullRequest.number}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", isCurrent && "font-medium")}>
                {pullRequest.title}
              </span>
              {checks === undefined ? null : (
                <span className={cn("shrink-0 text-[11px]", checks.className)}>
                  {checks.text}
                </span>
              )}
              {depth === 0 && entries.length > 1 ? (
                <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground">
                  stack · {entries.length}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
