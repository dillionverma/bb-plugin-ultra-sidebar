# Ultra Sidebar

Group bb threads into collapsible sidebar sections — a pinned list on top,
then by project or by status — with subagent threads nested under the thread
that spawned them.

> **This plugin replaces bb's sidebar thread list**, which is bb's one
> *exclusive* slot — only one plugin can fill the sidebar's scroll area. If you
> have another thread-list plugin enabled, one of them wins and the other is
> silently inactive. Choose between them under
> **Settings → Appearance → Sidebar**. The choice is per client.
>
> bb keeps the New-thread button, the search action, the plugin nav rows and
> the footer in every sidebar; this plugin owns the scrolling list only, so its
> own controls live at the top of that list.

## Install

```
npm install --include=dev
bb plugin install .
```

`bb plugin dev` gives you a save → rebuild → reload loop while working on it.

## What it does

- **Projects are the only containers.** Every thread sits under the project bb
  says it belongs to, and each project renders as a collapsible section. There
  is nothing else to file things into, and nothing to set up.
- **Pinned threads lead the list.** Pin a thread and it leaves its project for
  a **Pinned** section at the very top, where it stays until you unpin it. The
  pin is bb's own, so it is the same pin bb's built-in sidebar shows, and a
  pinned row names its own project since the heading above it does not.
- **Or group by status instead**, and the five buckets replace the project
  sections. Rows name their project either way when the heading does not.
- **Subagent threads nest under their parent**, recursively and at any depth:
  a grandchild indents past its parent, a great-grandchild past that. The step
  tightens as the tree deepens so a title always has room, and past twelve
  levels a row also carries its level as a number. They are collapsed by
  default. A collapsed parent shows the descendant count and lights up when a
  subagent anywhere below it is waiting; opening the thread that is waiting
  opens every chevron above it. Dragging a parent moves its whole subtree.

## Using it

- **Drag** a thread to reorder it inside its section, or onto another heading
  to say what that heading means: a status bucket files it, **Pinned** pins it,
  and its own project takes it back — unpinned, and off whatever parked pile it
  was on. Another project's heading does nothing, because a drag cannot change
  which project a thread belongs to. Drag a project heading to reorder the
  projects. Hovering a collapsed section during a drag opens it.
- **Right-click** anything for the same operations plus rename, pin, archive
  and delete. Everything reachable by drag is reachable from the menu.
- **Statuses**, the way Conductor does them. Every thread is in exactly one
  of five buckets: **In progress** (the default), **In review** (its pull
  request is open), **Done** (its pull request merged, or you marked it),
  **Backlog** and **Canceled** (you moved it there). A status you set by hand
  sticks until you change it. Grouping by status shows the five buckets;
  grouping by project keeps Done, Backlog and Canceled in their own headings
  at the bottom so finished work stops crowding the list.
- **Hover** a row to reveal its quick actions beside the title: a pin that
  lifts the thread to the top, a clock that snoozes it until 9am tomorrow, and
  a **Done** checkmark. Snooze moves
  the thread out of the list and into the **Snoozed** dock at the bottom of the
  sidebar, where it shows its wake time and a **Wake** button; it does not pause
  its agent or schedule work. A snoozed thread comes back on its own the moment
  it asks a question, fails, or starts working. The right-click menu has a
  **Status** submenu and the full set of snooze durations.
- **The folder, branch and pull-request badges are links.** Hovering the
  folder or branch shows the checkout's path and which machine it is on;
  clicking reveals it in Finder (or the platform's file manager) when the
  folder is on the machine bb runs on, and says where it is otherwise.
  Hovering the PR badge shows its title and state; clicking opens it in the
  browser. Both are in the right-click menu too, as **Open folder** and
  **Open pull request**.
- **Rest on a row** for a moment and a detail card opens beside it: project,
  machine, environment, branch, agent and model, the pull request, subagents,
  what is running, and when it was last active. With the
  [PR Stacks](https://github.com/dillionverma/bb-pr-stacks) plugin installed,
  the card also lists the stack the thread's branch belongs to, indented from
  bottom to top with each PR's state and check result.
- **`Alt` + `↑`/`↓`** on a focused row moves it without a pointer.
- **The sliders button** at the top of the list opens every view option:
  group by project or status; pick which
  facts each row shows under its title (project, branch, machine, model,
  pull request, agent); include archived threads; collapse or
  expand every section. Row details and grouping persist per client.
- Threads sort newest-created first until you place them by hand. Dragging one
  places every row in that section at once, so the rest do not scatter, and the
  section's heading picks up a small sort glyph. A new thread still arrives
  above the ones you arranged, so a hand-picked order never buries today's
  work. **Sort by most recent** in the heading's context menu undoes it.
- Positions are one global order sliced by whatever you are grouping by, so a
  drag inside a status bucket and a drag inside a project group can never
  disagree about the same two rows.

## Undo and keyboard shortcuts

Every status change, snooze, reorder and thread rename has an **Undo** toast. **Ctrl/Cmd+Z** undoes and **Ctrl/Cmd+Shift+Z** redoes;
Windows/Linux also support Ctrl+Y. Undo is also available in each action toast.
History holds the last 50 actions in this sidebar session and resets on reload.
Bulk actions and drag operations undo in one step. Changes to the same rows in
another client cause a conflict instead of being overwritten. Pinning, archiving
and deleting continue to use bb's own flows and are outside this history.

Use **Ctrl/Cmd-click** to toggle selected threads and **Shift-click** for a range,
or use the row checkboxes, revealed on hover, focus, or touch. The floating selection controls can move,
mark done, reopen or snooze all selected threads at once. **Escape** clears the
selection. Ctrl/Cmd-click now selects; **Shift+Enter** or **Open in split** opens a split.

With a sidebar row focused:

| Shortcut | Action |
| --- | --- |
| ↑ / ↓ | Focus previous / next row |
| Shift+↑ / ↓ | Extend selection |
| Ctrl/Cmd+A | Select visible rows |
| Enter / Shift+Enter | Open / open in split |
| F2 | Rename |
| D | Mark done / reopen |
| P | Pin to the top / unpin |
| S | Snooze until tomorrow at 9am |
| Alt+↑ / ↓ | Reorder |
| ? | Shortcut help |

Text fields, editors, terminals, menus and dialogs retain their own keyboard
behavior. When a focused thread disappears, focus moves to the next visible row.

Order, status and snooze live in this plugin's own SQLite database. bb's own
projects and threads are never modified for them, so uninstalling loses that
state and nothing else.

## From a terminal

`bb sidebar` reads and files what the sidebar shows — see
[skills/sidebar/SKILL.md](skills/sidebar/SKILL.md), which is also loaded into
agent threads so agents can triage for you.

```
bb sidebar list --project proj_abc123
bb sidebar status done --thread thr_abc123
bb sidebar snooze --thread thr_abc123 --hours 4
```

Pinning is not there: it belongs to bb rather than to this plugin, and the
plugin SDK exposes it only to the sidebar itself.

## Tests

```
npm test
```

Covers the resolver's ordering and pinning rules and the rendered list, including the
assertion that every row carries `data-sidebar-thread-shortcut-target` and
`data-sidebar-thread-id` — a DOM contract bb's keyboard shortcuts depend on,
and one whose breakage is invisible until someone reaches for the keyboard.

### Thread status and change counts

The second row shows the project name and a small machine icon, followed by
useful status and mode information. Status bucket names stay in section headings,
with counts beside the heading. Status colors
live on the indicators and labels; rows use BB's normal background. The
sidebar shows simple status without command text, tool steps, or elapsed
timers, and no longer polls for those activity details.

Below each title, project, machine, status and mode information sits on the left and change counts
sit in a consistent column on the right. Additions are green and deletions
are red. Long labels and change totals wrap within their columns on narrow
screens. Opening a thread from that line closes the mobile drawer as usual.

Counts include committed changes against the environment's comparison branch
and current local edits. Environments without a comparison branch use local
edits only. Threads sharing an environment share its counts. Unstaged and
staged edits remain visible when a large set of untracked files cannot be
fully counted. Partial-count context stays in the hover text and accessible label;
the row shows only the numbers. These are lower bounds, not zero changes. Clean environments and environments with no available
counts do not show a count. Counts refresh every
15 seconds while the page is visible and when it regains focus.

### Goal, plan, and scheduled-message indicators

Rows show small, theme-colored Goal and Plan chips independently of the main
status, including while running or waiting for input. A clock chip shows queued
messages with the next scheduled time in the viewer's local timezone. Queue
failures and retries take precedence over the time label. Hover reveals the full
date and queue count. Ordinary rows retain their existing density.

Queue metadata refreshes every 15 seconds and on reconnect through one aggregate
RPC; message contents are not sent to the sidebar. These indicators describe
messages already queued on a thread, not future recurring automation runs.
Goal and plan visibility uses the host's live activity counts; completed goal
history and budget progress are not exposed by those counts. Clicking Plan opens
its own anchored popup with the current planning request and an Open thread action;
Goal and scheduled-message details also open directly from their own chips.

## Sidebar layout and actions

- Compact rows use BB's native background and theme colors, the original Linear status colors, and tree connectors for expanded groups and subagents.
- Threads waiting on an answer or approval show a solid amber **Your turn** badge beside the title in both row layouts. A static return arrow replaces the activity animation until the request is resolved; opening or selecting the thread does not hide the badge.
- Active titles retain neutral text shimmer; reduced-motion settings disable it. Agent, project, machine and modes share one supporting line; the View options → Agent switch hides the agent icon. Click Goal or the machine icon for details, including actual goal objective and usage.
- Queued message times remain attached to their threads. The bottom dock holds two collapsible sections that stay in view however long the list is: **Scheduled** reads recurring and one-time automations and respects the project filter, and **Snoozed** lists parked threads with their wake time. Rows in the dock are built like thread rows: a glyph, the name, and one word on the right in its status colour (next run, "Failed 2h ago", "Paused", a live orb while "Running"). Clicking a schedule opens the thread that ran it; before the first run it shows the details instead. Hovering reveals Run now, Pause/Resume and an info button; right-click gives the same menu. The details popover has **Run now**, **Pause**/**Resume**, **Open last run**, and **Delete…**, which asks once more before removing the automation for good. Opening the Automations panel itself from the sidebar is not possible: the plugin SDK only navigates to a plugin's own panels. Missing or disabled Automations hides the section; loading failures offer Retry.
- Select threads from the toolbar or right-click empty sidebar space. Checkboxes occupy a separate column; status icons remain visible. The small bottom selection menu reserves its own space and closes after an action, Escape, dismissal, or clicking away. Hidden selections remain counted. Cmd/Ctrl-click and Shift selection remain available.
- Thread and section context menus group navigation, organization, preferences, and removal actions with icons. Right-click empty sidebar space for creation, selection, collapse/expand, and view options. Native text-field context menus remain available.
- View options → Compact rows restores the detailed row layout.
- Project headings, the project badge on rows, and the details card use each project's own artwork when it has some: the BB icon named by `bb.branding.icon` in its `package.json`, an icon or logo path declared there, or a conventionally named `favicon`, `icon`, `logo`, or `apple-touch-icon` file found in the project's default checkout (SVG, PNG, WebP, JPEG, or ICO, under 2 MB; SVGs are checked for scripts and external references before they are served). Projects without any keep the folder icon. View options → Project icons turns the lookup off.

### Active threads and detail cards

Rows use BB’s native backgrounds, neutral title shimmer, and the original Linear status colors on icons and labels. Native hover and selection states remain intact.

The detail card pairs the full title with a status badge, combines project and machine context, and shows the model and reasoning level beside an inline Details disclosure. Execution settings load on demand even when model names are hidden in rows. Details reveals labeled execution settings, the folder, and exact update time. Threads needing attention include a direct action; goals, queue problems, and pull-request attention remain visible. Running threads omit the thread-record age, while fresh updates read “Just now.”

### Quick handoff

Hover or keyboard-focus a thread and choose **Hand off thread**. Search is at the top, with provider icon tabs directly underneath. Click a provider tab, then a model, or choose **Same agent**. Use the arrow keys and Enter for keyboard selection. Tooltips explain the action and show full model names. The successor opens automatically and keeps the source checkout. Errors stay in the picker for retry. Requires the Ultra Topbar plugin; its equivalent CLI is `bb handoff THREAD-ID --provider PROVIDER-ID --model MODEL-ID`.

Catalogs preload on hover or keyboard focus and cache for five minutes; loaded provider tabs switch without a network request, and search text stays intact. Successful model picks are remembered on this client and sorted by frequency, then recency. Provider tabs keep their original order.

The sidebar shows provider logos beside thread titles in both row layouts; the tooltip includes the model when execution metadata is available.

The toolbar's project picker narrows both groupings, the Pinned list and the docks. It supports search and multiple selections, and persists per browser.
