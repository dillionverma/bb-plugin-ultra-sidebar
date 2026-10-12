---
name: thread-history
description: How Ultra Sidebar's back/forward thread shortcuts work and how to rebind or troubleshoot them. Use when the user asks about Cmd+[ / Cmd+] thread navigation, "go back to the last thread", or why the shortcut does nothing.
---

# Thread history

Ultra Sidebar remembers the threads opened in each BB window, in the order they
were opened, and moves through that list like browser history:

- `Mod+[` — back to the thread opened before this one
- `Mod+]` — forward to the thread you went back from

`Mod` is Command on macOS and Control elsewhere. The same two actions appear in
the quick palette (`Mod+Shift+P`) as "Back to previous thread" and "Forward to
next thread". Opening a different thread after going back discards the forward
entries. History is per window, survives a reload, and keeps the last 50
threads.

## Constraints

- The keys are bound by Ultra Sidebar itself, not through Settings → Keyboard, so
  they cannot be rebound there. BB's own `thread.previous` / `thread.next`
  commands must not share the keys: check `bb settings keyboard list` and use
  `bb settings keyboard reset thread.previous` (and `thread.next`) if they were
  overridden to `Mod+[` / `Mod+]`.
- Nothing happens when there is no earlier or later thread; the keystroke then
  falls through to BB and the browser.
- There are no settings, CLI commands, or server-side state for history.
- The standalone Thread History plugin must stay disabled. With both enabled, each shortcut is handled twice and the palette lists each action twice.
- Reload after changes with `bb plugin reload workspace-sidebar`.
