import { describe, expect, it } from "vitest";
import { bucketFromSectionId, statusBucket, statusSectionId } from "./status";

describe("statusBucket", () => {
  it("defaults to in progress", () => {
    expect(statusBucket(null, undefined)).toBe("in-progress");
  });

  it("reads the bucket off the pull request", () => {
    expect(statusBucket(null, { state: "open" })).toBe("in-review");
    expect(statusBucket(null, { state: "merged" })).toBe("done");
    expect(statusBucket(null, { state: "closed" })).toBe("canceled");
    // A draft is not yet asking anyone for anything.
    expect(statusBucket(null, { state: "draft" })).toBe("in-progress");
  });

  it("lets a manual status override the pull request", () => {
    expect(statusBucket("backlog", { state: "open" })).toBe("backlog");
    expect(statusBucket("done", undefined)).toBe("done");
    expect(statusBucket("canceled", { state: "merged" })).toBe("canceled");
  });
});

describe("status section ids", () => {
  it("round-trips a bucket and rejects anything else", () => {
    expect(bucketFromSectionId(statusSectionId("in-review"))).toBe("in-review");
    expect(bucketFromSectionId("status:nope")).toBeNull();
    expect(bucketFromSectionId("project:p1")).toBeNull();
    expect(bucketFromSectionId(null)).toBeNull();
  });
});
