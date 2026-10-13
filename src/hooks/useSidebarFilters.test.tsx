// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SIDEBAR_FILTERS_KEY, useSidebarFilters } from "./useSidebarFilters";
import { PROJECT_FILTER_KEY } from "./useViewState";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("migrates a single-project preference and keeps clearing durable", () => {
  window.localStorage.setItem(PROJECT_FILTER_KEY, "p1");
  const first = renderHook(useSidebarFilters);
  expect(first.result.current.projectIds).toEqual(["p1"]);
  act(() => first.result.current.clear());
  first.unmount();
  const second = renderHook(useSidebarFilters);
  expect(second.result.current.projectIds).toEqual([]);
});

it("persists multiple projects, de-duplicated", () => {
  const first = renderHook(useSidebarFilters);
  act(() => first.result.current.setProjects(["p1", "p2", "p1"]));
  first.unmount();
  const second = renderHook(useSidebarFilters);
  expect(second.result.current.projectIds).toEqual(["p1", "p2"]);
});

it.each(["invalid json", '{"projectIds":"p1"}', '{"projectIds":[null]}'])("recovers from invalid persisted filters: %s", raw => {
  window.localStorage.setItem(SIDEBAR_FILTERS_KEY, raw);
  const { result } = renderHook(useSidebarFilters);
  expect(result.current.projectIds).toEqual([]);
});

it("keeps filtering usable when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const { result } = renderHook(useSidebarFilters);
  act(() => result.current.setProjects(["p1", "p2"]));
  expect(result.current.projectIds).toEqual(["p1", "p2"]);
});
