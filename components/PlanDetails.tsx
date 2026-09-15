import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { useSidebar } from "./sidebar-context";
import { ModeIcon } from "./ThreadModes";

type PlanMode = { mode: "plan"; prompt: string; providerId: string };
type PlanState = { plan: PlanMode | null; loading: boolean; failed: boolean };

/** The host's current Plan card data, fetched only while details are mounted. */
export function PlanDetails({ threadId, updatedAt }: { threadId: string; updatedAt: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const sidebar = useSidebar();
  const [state, setState] = useState<PlanState>({ plan: null, loading: true, failed: false });
  useEffect(() => {
    let disposed = false;
    setState({ plan: null, loading: true, failed: false });
    void rpc.call("threads.plan", { threadId }).then(
      ({ plan }) => { if (!disposed) setState({ plan, loading: false, failed: false }); },
      () => { if (!disposed) setState({ plan: null, loading: false, failed: true }); },
    );
    return () => { disposed = true; };
  }, [rpc, threadId, updatedAt]);

  const prompt = state.plan?.prompt.trim() ?? "";
  return <section className="flex flex-col gap-1.5 border-t border-border pt-2.5" aria-label="Plan details">
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><ModeIcon kind="plan" />Plan
      {state.plan ? <span className="ml-auto font-normal">Active</span> : null}
    </div>
    {state.loading ? <p className="text-[11px] text-muted-foreground" role="status">Loading plan…</p>
      : prompt ? <>
        <p className="text-[11px] text-muted-foreground">Planning request</p>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere]">{prompt}</p>
      </> : <p className="text-[11px] text-muted-foreground">{state.failed
        ? "Plan details are unavailable."
        : state.plan ? "Plan mode is active. No planning request text is available."
          : "Plan mode is no longer active."}</p>}
    <button
      type="button"
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); sidebar.openThread(threadId, false); }}
      className="self-start rounded-sm text-xs text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >Open thread</button>
  </section>;
}
