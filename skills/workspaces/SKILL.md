---
name: workspaces
description: Group bb projects and threads into sidebar workspaces with the `bb workspace` command. Use when asked to organize, group, file, or tidy the sidebar, to put projects or threads into a named workspace, or to inspect how the sidebar is grouped.
---

# Sidebar workspaces

This bb has the Workspaces plugin installed. It replaces the sidebar thread
list with collapsible **workspaces**: named containers that group projects and
threads. Manage them with `bb workspace`.

## The model, in three rules

1. A project or thread belongs to **exactly one** workspace. Anything with no
   assignment shows up under **Unassigned**.
2. A thread **inherits** its project's workspace. You almost never need to
   assign threads individually — assign the project and its threads follow.
3. Subagent threads are **nested under the thread that spawned them** and are
   not assigned separately. A subtree always follows its root.

## Commands

```
bb workspace list                      # workspaces with member counts
bb workspace show <workspace>          # one workspace's members
bb workspace new <name>
bb workspace rename <workspace> <new-name>
bb workspace rm <workspace> [--move-to <workspace>] [--yes]
bb workspace assign <workspace> (--project <id> | --thread <id>)...
bb workspace unassign (--project <id> | --thread <id>)...
bb workspace detach (--thread <id>)...
bb workspace sort <workspace> (recent|manual)
bb workspace status (in-progress|backlog|done|canceled) (--thread <id>)...
```

`<workspace>` is an id, a full name, or an unambiguous name prefix. Every
command accepts `--json`.

Get project ids from `bb project list`.

## unassign vs detach

These are different, and picking the wrong one is the easy mistake:

- **`unassign`** deletes the explicit assignment, so the item goes back to
  inheriting. An unassigned *thread* returns to its project's workspace.
- **`detach`** pins a thread to Unassigned *even though* its project sits in a
  workspace. Use this only when the user wants one thread deliberately kept out
  of its project's group.

## Status

Every thread sits in one of five buckets, the way Conductor does it: **In
progress** (the default), **In review** (its pull request is open), **Done**
(pull request merged, or set by hand), **Backlog** and **Canceled** (set by
hand). `bb workspace status` sets the hand-picked ones; `in-progress` clears
the hand-picked status so the thread's own facts decide again. In review
cannot be set by hand — open a pull request.

## Ordering

Workspaces sort threads by most recent by default. Dragging a thread in the
sidebar, or `bb workspace sort <workspace> manual`, switches that workspace to
the user's manual order and holds it there.

## Do not

- Do not reorganize a user's workspaces unasked. The grouping is theirs.
- Do not `bb workspace rm` without `--move-to` or an explicit instruction to
  discard the grouping; without one of those the command refuses anyway.

## Sidebar filtering

The toolbar's left workspace picker narrows the sidebar to one workspace or
Unassigned. Its project picker searches and selects multiple projects; All
projects clears that selection. Switching workspace resets project selections.
These per-browser filters persist across reloads, work in every grouping mode,
and also narrow Scheduled. They do not change membership; use the commands above
to move projects or threads between workspaces.
