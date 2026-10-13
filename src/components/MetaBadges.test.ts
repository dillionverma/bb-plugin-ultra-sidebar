import { describe, expect, it } from "vitest";
import { shortenModel } from "./MetaBadges";

describe("shortenModel", () => {
  it("keeps the family and the distinguishing parts", () => {
    expect(shortenModel("claude-opus-5")).toBe("opus-5");
    expect(shortenModel("claude-sonnet-5")).toBe("sonnet-5");
    expect(shortenModel("gpt-6-astra")).toBe("gpt-6-astra");
    expect(shortenModel("claude-haiku-4-5")).toBe("haiku-4-5");
  });

  it("strips context-window suffixes and vendor prefixes", () => {
    expect(shortenModel("claude-opus-5[1m]")).toBe("opus-5");
    expect(shortenModel("us.anthropic.claude-sonnet-5")).toBe("sonnet-5");
  });

  it("drops build dates and bare version tags", () => {
    expect(shortenModel("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
    expect(shortenModel("claude-sonnet-5-v1")).toBe("sonnet-5");
  });

  it("falls back to a truncated tail for an unrecognized model", () => {
    expect(shortenModel("some-vendor/tiny")).toBe("tiny");
    expect(shortenModel("averylongunbrokenmodelidentifier")).toBe(
      "averylongunbroken…",
    );
  });
});
