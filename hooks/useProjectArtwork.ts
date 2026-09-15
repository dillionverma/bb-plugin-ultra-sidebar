// Project artwork: an icon or logo found in each project's files, or the BB
// glyph its package.json names, so a project heading can look like the
// project rather than like every other folder.
//
// The lookup is one batched RPC per set of projects. Answers are remembered
// for the life of the window: a project's artwork changes about never, and
// the server keeps its own TTL cache behind the call anyway.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export type ProjectArtwork =
  | { kind: "image" }
  | { kind: "glyph"; svg: string };

export type ProjectArtworkMap = ReadonlyMap<string, ProjectArtwork>;

const EMPTY: ProjectArtworkMap = new Map();
const BATCH = 300;

export function useProjectArtwork(
  projects: readonly PluginSidebarProject[],
  enabled: boolean,
): ProjectArtworkMap {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<ProjectArtworkMap>(EMPTY);
  // Every project ever asked about, answered or not. A miss is final for
  // this window: asking again on each re-render would be a search per paint.
  const asked = useRef(new Set<string>());

  // Personal has no files to search. A primitive key, so the effect fires on
  // a real change rather than on every new array the host hands us.
  const pendingKey = enabled
    ? projects
        .filter((project) => !project.isPersonal && !asked.current.has(project.id))
        .map((project) => project.id)
        .join(",")
    : "";

  // Only unmount drops an answer. The key goes back to "" the moment a batch
  // is marked asked, so tying cancellation to it would discard every reply.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (pendingKey === "") return;
    const pending = pendingKey.split(",");
    for (const id of pending) asked.current.add(id);

    for (let start = 0; start < pending.length; start += BATCH) {
      const projectIds = pending.slice(start, start + BATCH);
      rpc.call("projects.artwork", { projectIds }).then(
        (result) => {
          if (!alive.current) return;
          setEntries((current) => {
            const next = new Map(current);
            for (const entry of result.entries) {
              if (entry.kind === "glyph") next.set(entry.projectId, { kind: "glyph", svg: entry.svg });
              else if (entry.kind === "image") next.set(entry.projectId, { kind: "image" });
            }
            return next;
          });
        },
        () => {
          // Artwork is decoration; a failed lookup leaves the folder icon.
        },
      );
    }
  }, [rpc, pendingKey]);

  return enabled ? entries : EMPTY;
}
