// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  STACK_ENDPOINT,
  StackList,
  flattenStack,
  parseStackResponse,
  prefetchPullRequestStack,
  usePullRequestStack,
  type StackNode,
} from "./PullRequestStack";

function pr(
  number: number,
  headRefName: string,
  overrides: Partial<StackNode["pullRequest"]> = {},
): StackNode["pullRequest"] {
  return {
    number,
    title: `PR ${number}`,
    headRefName,
    state: "open",
    isDraft: false,
    url: `https://github.com/o/r/pull/${number}`,
    checks: "passing",
    ...overrides,
  };
}

const stack: StackNode = {
  pullRequest: pr(1, "one"),
  children: [
    {
      pullRequest: pr(2, "two", { isDraft: true, checks: "failing" }),
      children: [{ pullRequest: pr(3, "three"), children: [] }],
    },
  ],
};

const okBody = {
  ok: true,
  result: { status: "ok", repo: "o/r", currentBranch: "two", stack },
};

function Probe({ threadId }: { threadId: string }) {
  const { isLoading, data } = usePullRequestStack(threadId);
  if (isLoading) return <p>loading</p>;
  if (data === null) return <p>no stack</p>;
  return <StackList data={data} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("parseStackResponse", () => {
  it("reads a stack out of the RPC envelope", () => {
    expect(parseStackResponse(okBody)).toEqual({
      repo: "o/r",
      currentBranch: "two",
      stack,
    });
  });

  it("treats every non-stack outcome as nothing to show", () => {
    expect(
      parseStackResponse({
        ok: true,
        result: { status: "no-pull-request", repo: "o/r", currentBranch: "x" },
      }),
    ).toBeNull();
    expect(
      parseStackResponse({
        ok: true,
        result: { status: "gh-missing", message: "no gh" },
      }),
    ).toBeNull();
    expect(parseStackResponse({ ok: false, error: {} })).toBeNull();
    expect(parseStackResponse(null)).toBeNull();
  });
});

describe("flattenStack", () => {
  it("lists parents before children with their depth", () => {
    expect(
      flattenStack(stack).map((entry) => [entry.pullRequest.number, entry.depth]),
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });
});

describe("usePullRequestStack", () => {
  it("asks the PR Stacks plugin for the thread and renders the chain", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => okBody,
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Probe threadId="thr_stack" />);
    expect(screen.getByText("loading")).toBeTruthy();

    const list = await screen.findByLabelText("Pull request stack");
    expect(fetchMock).toHaveBeenCalledWith(
      STACK_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ threadId: "thr_stack" }),
      }),
    );

    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.getAttribute("aria-current")).toBeNull();

    // Every PR is its own link out to GitHub.
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/2",
      "https://github.com/o/r/pull/3",
    ]);
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    // Only the bottom PR wears the stack badge; only a check result that
    // needs a look gets a word.
    expect(links[0]!.textContent).toContain("stack · 3");
    expect(links[1]!.textContent).not.toContain("stack ·");
    expect(links[1]!.textContent).toContain("Draft pull request");
    expect(links[1]!.textContent).toContain("failing");
    expect(links[0]!.textContent).not.toContain("passing");
    // Depth reads as indentation.
    expect(links[2]!.style.paddingLeft).toBe("32px");
  });

  it("shows nothing when the plugin is not installed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    render(<Probe threadId="thr_missing" />);
    await waitFor(() => expect(screen.getByText("no stack")).toBeTruthy());
  });

  it("shows nothing when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<Probe threadId="thr_offline" />);
    await waitFor(() => expect(screen.getByText("no stack")).toBeTruthy());
  });

  it("shares a prefetch started before the card opened", async () => {
    let release: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    prefetchPullRequestStack("thr_prefetch");
    prefetchPullRequestStack("thr_prefetch");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    render(<Probe threadId="thr_prefetch" />);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release({ ok: true, json: async () => okBody });
    await screen.findByLabelText("Pull request stack");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent answer instead of asking again", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => okBody,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<Probe threadId="thr_cached" />);
    await screen.findByLabelText("Pull request stack");
    first.unmount();

    render(<Probe threadId="thr_cached" />);
    expect(screen.getByLabelText("Pull request stack")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
