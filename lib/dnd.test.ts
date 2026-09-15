import { describe, expect, it } from "vitest";
import {
  hoverKeys,
  resolveDrop,
  sortableId,
  type DragSource,
  type DropZone,
} from "./dnd";
import { projectSectionId } from "./regroup";
import { statusSectionId } from "./status";

const zone = (
  kind: DropZone["kind"],
  refId: string | null,
  workspaceId: string | null,
): DropZone => ({ kind, refId, workspaceId });

const thread = (workspaceId: string | null): DragSource => ({
  kind: "thread",
  refId: "t1",
  workspaceId,
});

describe("resolveDrop in a real workspace", () => {
  it("reorders a thread against a sibling in its own section", () => {
    expect(resolveDrop(thread("ws1"), zone("thread", "t2", "ws1"))).toEqual({
      action: "reorder",
      workspaceId: "ws1",
      anchorRefId: "t2",
    });
  });

  it("moves a thread to a row in another section", () => {
    expect(resolveDrop(thread("ws1"), zone("thread", "t2", "ws2"))).toEqual({
      action: "move",
      workspaceId: "ws2",
      anchorRefId: "t2",
    });
  });

  it("moves a thread into a workspace by its header, or a project heading", () => {
    expect(resolveDrop(thread("ws1"), zone("workspace", "ws2", "ws2"))).toEqual({
      action: "move",
      workspaceId: "ws2",
      anchorRefId: null,
    });
    expect(resolveDrop(thread("ws1"), zone("project", "p1", null))).toEqual({
      action: "move",
      workspaceId: null,
      anchorRefId: null,
    });
  });

  it("ignores a hover over the row itself or its own section's header", () => {
    expect(resolveDrop(thread("ws1"), zone("thread", "t1", "ws1"))).toBeNull();
    expect(resolveDrop(thread("ws1"), zone("workspace", "ws1", "ws1"))).toBeNull();
  });

  it("orders a workspace only against another real workspace", () => {
    const workspace: DragSource = {
      kind: "workspace",
      refId: "ws1",
      workspaceId: "ws1",
    };
    expect(resolveDrop(workspace, zone("workspace", "ws2", "ws2"))).toEqual({
      action: "reorder",
      workspaceId: null,
      anchorRefId: "ws2",
    });
    expect(resolveDrop(workspace, zone("workspace", "ws1", "ws1"))).toBeNull();
    expect(resolveDrop(workspace, zone("workspace", null, null))).toBeNull();
    expect(resolveDrop(workspace, zone("thread", "t2", "ws2"))).toBeNull();
    expect(
      resolveDrop(workspace, zone("workspace", statusSectionId("done"), statusSectionId("done"))),
    ).toBeNull();
  });
});

describe("resolveDrop on a status bucket", () => {
  const done = statusSectionId("done");
  const backlog = statusSectionId("backlog");

  it("files a thread into another bucket from a row or the header", () => {
    expect(resolveDrop(thread(done), zone("thread", "t2", backlog))).toEqual({
      action: "status",
      bucket: "backlog",
    });
    expect(resolveDrop(thread("ws1"), zone("workspace", done, done))).toEqual({
      action: "status",
      bucket: "done",
    });
  });

  it("does nothing within the same bucket, which has no order to change", () => {
    expect(resolveDrop(thread(done), zone("thread", "t2", done))).toBeNull();
    expect(resolveDrop(thread(done), zone("workspace", done, done))).toBeNull();
  });

  it("refuses projects", () => {
    const project: DragSource = { kind: "project", refId: "p1", workspaceId: "ws1" };
    expect(resolveDrop(project, zone("workspace", done, done))).toBeNull();
  });
});

describe("resolveDrop on a project group", () => {
  it("never accepts a thread: a drag cannot change its project", () => {
    const p1 = projectSectionId("p1");
    const p2 = projectSectionId("p2");
    expect(resolveDrop(thread(p1), zone("thread", "t2", p2))).toBeNull();
    expect(resolveDrop(thread(p1), zone("workspace", p1, p1))).toBeNull();
  });
});

describe("hoverKeys", () => {
  it("lights nothing for a reorder, the list animation already says it", () => {
    expect(
      hoverKeys({ action: "reorder", workspaceId: "ws1", anchorRefId: "t2" }, zone("thread", "t2", "ws1"), "before"),
    ).toEqual({ section: null, line: null });
  });

  it("rings the section and lines the row for a move", () => {
    expect(
      hoverKeys({ action: "move", workspaceId: "ws2", anchorRefId: "t2" }, zone("thread", "t2", "ws2"), "after"),
    ).toEqual({ section: "section:ws2", line: "thread:t2:after" });
    expect(
      hoverKeys({ action: "move", workspaceId: null, anchorRefId: null }, zone("workspace", null, null), "after"),
    ).toEqual({ section: "section:__unassigned__", line: null });
  });

  it("rings the bucket for a filing", () => {
    const done = statusSectionId("done");
    expect(
      hoverKeys({ action: "status", bucket: "done" }, zone("workspace", done, done), "after"),
    ).toEqual({ section: `section:${done}`, line: null });
  });
});

describe("sortableId", () => {
  it("is unique per list, including a project shown in two sections", () => {
    expect(sortableId(zone("thread", "t1", "ws1"))).toBe("thread:t1");
    expect(sortableId(zone("project", "p1", "ws1"))).toBe("project:ws1:p1");
    expect(sortableId(zone("project", "p1", null))).toBe("project:__unassigned__:p1");
    expect(sortableId(zone("workspace", "ws1", "ws1"))).toBe("workspace:ws1");
    expect(sortableId(zone("workspace", null, null))).toBe("workspace:__unassigned__");
  });
});
