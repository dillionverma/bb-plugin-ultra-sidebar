import { useEffect, useState } from "react";
import type { SnoozedEntry } from "../lib/resolve";
import { ScheduledSection } from "./ScheduledSection";
import { SnoozedSection } from "./SnoozedSection";

/**
 * A fixed strip under the scrolling list for the things that are not "now":
 * automations waiting for their time, and threads a person parked until
 * later. Pinned to the bottom so it stays in view however long the list gets,
 * and so the list itself never re-orders because something in here changed.
 * Renders nothing at all when both are empty.
 */
export function SidebarDock({ snoozed, projectIds }: { snoozed: readonly SnoozedEntry[]; projectIds: readonly string[] | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return <div className="bb-ws-dock shrink-0" data-sidebar-dock="">
    <ScheduledSection projectIds={projectIds} />
    <SnoozedSection entries={snoozed} now={now} />
  </div>;
}
