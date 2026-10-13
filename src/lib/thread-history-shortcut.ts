export interface ShortcutKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function isMacPlatform(
  nav: { platform?: string; userAgent?: string } | undefined = globalThis
    .navigator,
): boolean {
  const platform = nav?.platform || nav?.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function threadHistoryShortcutOffset(
  event: ShortcutKeyEvent,
  isMac: boolean,
): -1 | 1 | null {
  const modHeld = isMac ? event.metaKey : event.ctrlKey;
  const otherModHeld = isMac ? event.ctrlKey : event.metaKey;
  if (!modHeld || otherModHeld || event.altKey || event.shiftKey) return null;
  if (event.key === "[" || event.code === "BracketLeft") return -1;
  if (event.key === "]" || event.code === "BracketRight") return 1;
  return null;
}
