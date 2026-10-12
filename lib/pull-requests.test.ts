import { describe, expect, it } from "vitest";
import {
  isSettled,
  parsePullRequestRef,
  pullRequestFromGh,
} from "./pull-requests";

const ref = { repo: "acme/app", number: 12 };
const check = (conclusion: string) => ({ __typename: "CheckRun", conclusion });

describe("parsePullRequestRef", () => {
  it("reads a pull request out of a thread's own text", () => {
    expect(
      parsePullRequestRef(
        "Review placeholder for https://github.com/productstudioinc/cops/pull/1019. Di",
      ),
    ).toEqual({ repo: "productstudioinc/cops", number: 1019 });
  });

  it("takes the first text that names one", () => {
    expect(parsePullRequestRef(null, "no url here", "github.com/a/b/pull/7")).toEqual({
      repo: "a/b",
      number: 7,
    });
  });

  it("refuses a bare number: it names no repository to ask", () => {
    expect(parsePullRequestRef("Review PR #1019: remove archives")).toBeNull();
    expect(parsePullRequestRef(undefined, null)).toBeNull();
    // An issue is not a pull request.
    expect(parsePullRequestRef("https://github.com/a/b/issues/7")).toBeNull();
  });
});

describe("isSettled", () => {
  it("counts merged and closed as final, and nothing else", () => {
    expect(isSettled("merged")).toBe(true);
    expect(isSettled("closed")).toBe(true);
    expect(isSettled("open")).toBe(false);
    expect(isSettled("draft")).toBe(false);
  });
});

describe("pullRequestFromGh", () => {
  const view = (extra: Record<string, unknown> = {}) =>
    pullRequestFromGh(
      {
        number: 12,
        title: "Fix the thing",
        url: "https://github.com/acme/app/pull/12",
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [],
        reviewDecision: "",
        mergeable: "MERGEABLE",
        ...extra,
      },
      ref,
    );

  it("maps state, including the draft that only isDraft reveals", () => {
    expect(view()?.state).toBe("open");
    expect(view({ isDraft: true })?.state).toBe("draft");
    expect(view({ state: "MERGED" })?.state).toBe("merged");
    expect(view({ state: "CLOSED" })?.state).toBe("closed");
  });

  it("summarizes checks, counting anything unfinished as pending", () => {
    expect(view({ statusCheckRollup: [check("SUCCESS"), check("SKIPPED")] })).toMatchObject(
      { checksState: "passing", failedChecks: 0 },
    );
    expect(view({ statusCheckRollup: [check("SUCCESS"), check("FAILURE")] })).toMatchObject(
      { checksState: "failing", failedChecks: 1 },
    );
    expect(view({ statusCheckRollup: [check("SUCCESS"), check("")] })).toMatchObject(
      { checksState: "pending", failedChecks: 0 },
    );
    expect(view()?.checksState).toBe("no_checks");
  });

  it("reads the older StatusContext shape too", () => {
    expect(
      view({ statusCheckRollup: [{ __typename: "StatusContext", state: "ERROR" }] }),
    ).toMatchObject({ checksState: "failing", failedChecks: 1 });
  });

  it("ranks attention by what a person would act on first", () => {
    expect(view({ state: "MERGED" })?.attention).toBe("merged");
    expect(view({ isDraft: true, statusCheckRollup: [check("FAILURE")] })?.attention).toBe("draft");
    expect(view({ statusCheckRollup: [check("FAILURE")], reviewDecision: "CHANGES_REQUESTED" })?.attention).toBe("checks_failed");
    expect(view({ reviewDecision: "CHANGES_REQUESTED", mergeable: "CONFLICTING" })?.attention).toBe("changes_requested");
    expect(view({ mergeable: "CONFLICTING" })?.attention).toBe("conflicts");
    expect(view({ reviewDecision: "REVIEW_REQUIRED" })?.attention).toBe("review_requested");
    expect(view({ reviewDecision: "APPROVED" })?.attention).toBe("ready_to_merge");
    expect(view()?.attention).toBe("none");
  });

  it("falls back to the ref rather than throwing on a thin payload", () => {
    expect(pullRequestFromGh({ state: "MERGED" }, ref)).toEqual({
      number: 12,
      title: "",
      url: "https://github.com/acme/app/pull/12",
      state: "merged",
      attention: "merged",
      checksState: "no_checks",
      failedChecks: 0,
    });
    expect(pullRequestFromGh(null, ref)).toBeNull();
    expect(pullRequestFromGh({}, ref)).toBeNull();
  });
});
