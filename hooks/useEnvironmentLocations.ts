// Where each environment's checkout lives on disk.
//
// The sidebar payload carries a branch name but not a directory, and a folder
// link needs the directory. Fetched in one batch per set of unseen ids and
// kept for the life of the sidebar: a checkout does not move.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export interface EnvironmentLocation {
  path: string;
  hostId: string;
  hostName: string | null;
}

export type LocationMap = ReadonlyMap<string, EnvironmentLocation>;

/** The server's per-call ceiling; larger lists go up in pieces. */
const BATCH_SIZE = 300;

export function useEnvironmentLocations(
  threads: readonly PluginSidebarThread[],
): LocationMap {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<LocationMap>(() => new Map());
  // Ids asked about, answered or not, so an environment with no path is not
  // asked about again on every paint.
  const requested = useRef(new Set<string>());

  const missing = threads.flatMap((thread) => {
    const id = thread.environment?.id;
    return id == null || requested.current.has(id) ? [] : [id];
  });
  const key = [...new Set(missing)].sort().join(",");

  useEffect(() => {
    if (key === "") return;
    const ids = key.split(",");
    for (const id of ids) requested.current.add(id);

    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += BATCH_SIZE) {
      batches.push(ids.slice(index, index + BATCH_SIZE));
    }
    // Deliberately not cancelled when the key moves on: the list grows as
    // threads stream in, and a batch that was already in flight answers
    // facts that do not change. Dropping it would leave those ids marked as
    // asked-about but never answered.
    Promise.all(
      batches.map((environmentIds) =>
        rpc.call("environments.locations", { environmentIds }),
      ),
    ).then(
      (results) => {
        setEntries((current) => {
          const next = new Map(current);
          for (const result of results) {
            for (const entry of result.entries) {
              next.set(entry.environmentId, {
                path: entry.path,
                hostId: entry.hostId,
                hostName: entry.hostName,
              });
            }
          }
          return next;
        });
      },
      () => {
        // Let a failed batch be asked about again next time.
        for (const id of ids) requested.current.delete(id);
      },
    );
  }, [rpc, key]);

  return entries;
}
