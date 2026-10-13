// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankHandoffModels, recordHandoffModel } from "./handoff-preferences";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const models = [{ id: "a" }, { id: "b" }, { id: "c" }];
describe("handoff model order", () => {
  it("ranks successful picks by frequency then recency within each provider", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
    recordHandoffModel("codex", "b");
    recordHandoffModel("codex", "b");
    recordHandoffModel("codex", "c");
    expect(rankHandoffModels("codex", models)).toEqual([{ id: "b" }, { id: "c" }, { id: "a" }]);
    expect(rankHandoffModels("claude", models)).toEqual(models);
    expect(models[0].id).toBe("a");
  });
  it("preserves catalog order when stored preferences are invalid", () => {
    localStorage.setItem("bb-workspace-sidebar:handoff-model-usage:v1", '[{"count":"oops"}]');
    expect(rankHandoffModels("codex", models)).toEqual(models);
  });
  it("keeps the picker usable when local storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => recordHandoffModel("codex", "b")).not.toThrow();
    expect(rankHandoffModels("codex", models)).toEqual(models);
  });
});
