---
name: sidebar
description: Read and file the threads the Ultra Sidebar shows, with the `bb sidebar` command. Use when asked to triage, file, pin, snooze, or reorder threads in the sidebar, or to inspect how the sidebar is grouped.
---

# Ultra Sidebar

This bb has the Ultra Sidebar plugin installed. It replaces the sidebar thread
list with collapsible sections: a **Pinned** list on top, then the threads
grouped by **project** or by **status**. Read and file them with `bb sidebar`.

## The model, in four rules

1. A thread belongs to the project bb says it does. Nothing in this plugin
   moves it, and there is no other container — the sidebar has projects and
   nothing else.
2. A **pinned** thread leaves its project and leads the whole list. Pinning is
   bb's own, so it is the same pin bb's built-in sidebar shows.
3. Every thread sits in one of five status buckets. **In progress** is the
   default, **In review** means its pull request is open, **Done** means
   merged or filed by hand, and **Backlog** and **Canceled** are filed by hand.
4. Subagent threads are **nested under the thread that spawned them** and are
   never ordered separately. A subtree always follows its root.

## Commands

```
bb sidebar list [--project <id>]                 # threads with status and order
bb sidebar status (in-progress|backlog|done|canceled) (--thread <id>)...
bb sidebar snooze --thread <id> (--hours <n> | --until <epoch-ms> | --wake)
bb sidebar order (--project <id> | --thread <id>)...
bb sidebar unorder (--project <id> | --thread <id>)...
```

Every command accepts `--json`. Get project ids from `bb project list`.

Pinning is not here: it belongs to bb, not to this plugin's store, and the
plugin SDK exposes it only to the sidebar itself. Pin from the row's pin
button or its right-click menu.

## Status

`bb sidebar status` sets the hand-picked buckets. `in-progress` clears the
hand-picked status so the thread's own facts decide again. **In review** cannot
be set by hand — open a pull request.

A hand-set status sticks until somebody changes it, and it is what takes a
finished thread out of its project and down into the Done heading.

## Ordering

Threads sort newest-created first until somebody places them by hand, in the
sidebar by dragging or here with `bb sidebar order`. Placed threads hold their
positions; a brand new thread still arrives above them, so a hand-picked order
never buries today's work. `bb sidebar unorder` hands rows back to recency,
the same as **Sort by most recent** in a section's right-click menu.

Positions are global rather than per-section, so a drag inside a status bucket
and a drag inside a project group cannot disagree about the same two rows.

## Do not

- Do not reorder or refile a user's threads unasked. The order is theirs.
- Do not use `snooze` to park something that needs a person: a snoozed thread
  comes back on its own the moment it asks a question, fails, or starts
  working.

## Sidebar filtering

The toolbar's project picker searches and selects multiple projects; **All
projects** clears the selection. The filter persists per browser, works in both
groupings, narrows the Pinned list and the Scheduled dock too, and changes
nothing about membership.
