/** Provider agents belong to a real BB thread but have no BB thread of their own. */
export interface NativeSubagent {
  id: string;
  label: string;
  status: "pending" | "completed" | "error" | "interrupted";
  startedAt: number;
  depth: number;
}

export interface NativeSubagentEntry {
  threadId: string;
  agents: NativeSubagent[];
}

export const NATIVE_SUBAGENTS = "native-subagents";

/**
 * A provider names an agent however it likes — Codex reports paths like
 * `/root/sidebar_ux_review`. Show the last segment as words, so a sidebar row
 * reads as a task; the raw name stays available as hover text.
 */
export function agentLabel(raw: string): string {
  const tail = raw.split("/").filter(part => part.trim() !== "").at(-1) ?? "";
  const words = tail.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (words === "") return "Subagent";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
