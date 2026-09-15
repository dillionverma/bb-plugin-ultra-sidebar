# Ultra Sidebar

Built for extreme productivity across threads, agents, and projects. Keep parallel work moving from first prompt to finished PR.

A plugin for [BB](https://getbb.app).

## Highlights

- **One place for parallel work.** Group by workspace, project, or status. Nest subagents under their parent thread.
- **Act in batches.** Multi-select, drag, reorder, snooze, and mark work done. Undo and redo organization changes.
- **Stay on the keyboard.** Move rows with Alt+↑/↓; use shortcuts and context menus without opening every thread.
- **Review in context.** See branches, diffs, PRs, checks, agent activity, and stack relationships from the sidebar.
- **Know the project at a glance.** Project headings and rows show each project's own icon or logo, found the same way the homepage plugin finds it.

## Install

```sh
bb plugin install https://github.com/dillionverma/bb-plugin-ultra-sidebar
```

Requires BB 0.43+ and a compatible Plugin SDK (see `package.json`).

## Use

Open **Settings → Appearance → Sidebar** and select Ultra Sidebar. This plugin owns the sidebar thread list; only one replacement can be active.

Use `bb workspace --help` for workspace operations.

## Designed to stay responsive

Repeated diff and PR lookups use caches. Agent activity is followed for working or expanded threads. Model catalog requests are coalesced. These are implementation choices; no comparative speed benchmark is claimed.

See the [full guide](GUIDE.md) for statuses, bulk actions, undo, row details, and model handoff.

## Development

```sh
npm ci
npm test
bb plugin build .
```

Focused fixes and reproducible bug reports are welcome. Include BB version, platform, and steps to reproduce.

## Sidebar filters

The left side of the toolbar has a workspace picker and a searchable project
picker. Choose All workspaces, one workspace, or Unassigned. Projects can be
selected together; the picker stays open until Done. All projects or Clear
removes the project filter. Changing workspace resets the project selection.

Filters apply to every grouping mode, to scheduled tasks, and to the Snoozed
dock. A thread explicitly
filed in a workspace follows that placement, including its subagent tree.
Schedules follow their project's workspace. Empty projects remain available in
the picker and in project grouping. An empty result offers Clear filters.

Selections are local to each browser, survive reloads, and do not change project
or thread membership. Existing single-project preferences carry forward. Deleted
workspace or project selections fall back to the remaining valid selection.

## Compatibility

The repository and display name are independent of BB’s persistent plugin identity. The internal ID remains `workspace-sidebar` so existing settings, stored data, CLI commands, and integrations continue to work.

## The Ultra suite

Built for getting work done across multiple threads, agents, and projects. Install only the pieces you need.

- [Ultra Launcher](https://github.com/dillionverma/bb-plugin-ultra-launcher) — Start the next run.
- [Ultra Topbar](https://github.com/dillionverma/bb-plugin-ultra-topbar) — Turn threads into pull requests.
- [Linear Panel](https://github.com/dillionverma/bb-plugin-linear-panel) — Keep issues beside execution.
- [Usage Window](https://github.com/dillionverma/bb-plugin-usage-window) — Keep account capacity in view.

## License

MIT. See [LICENSE](LICENSE).
