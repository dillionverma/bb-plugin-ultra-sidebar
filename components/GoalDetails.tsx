import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { ModeIcon } from "./ThreadModes";

type Goal = {
  objective: string;
  status: "active" | "paused" | "budgetLimited" | "complete";
  timeUsedSeconds: number;
  tokensUsed: number;
  tokenBudget: number | null;
};
const LABEL: Record<Goal["status"], string> = {
  active: "Active", paused: "Paused", budgetLimited: "Budget reached", complete: "Complete",
};

/** Mounted in the detail popup only. Opening a row never downloads its history. */
export function GoalDetails({ threadId, updatedAt }: { threadId: string; updatedAt: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{ goal: Goal | null; loading: boolean; failed: boolean }>({ goal: null, loading: true, failed: false });
  useEffect(() => {
    let disposed = false;
    setState({ goal: null, loading: true, failed: false });
    void rpc.call("threads.goal", { threadId }).then(
      ({ goal }) => { if (!disposed) setState({ goal, loading: false, failed: false }); },
      () => { if (!disposed) setState({ goal: null, loading: false, failed: true }); },
    );
    return () => { disposed = true; };
  }, [rpc, threadId, updatedAt]);
  return <section className="flex flex-col gap-1.5 border-t border-border pt-2.5" aria-label="Goal details">
    <div className="ws-tone-goal flex items-center gap-1.5 text-[11px] font-medium"><ModeIcon kind="goal" />Goal
      {state.goal ? <span className="ml-auto text-muted-foreground">{LABEL[state.goal.status]}</span> : null}
    </div>
    {state.loading ? <p className="text-[11px] text-muted-foreground" role="status">Loading goal…</p>
      : state.goal ? <>
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{state.goal.objective}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <dt>Time used</dt><dd className="text-right tabular-nums">{Math.ceil(state.goal.timeUsedSeconds / 60).toLocaleString()} min</dd>
          <dt>Tokens used</dt><dd className="text-right tabular-nums">{state.goal.tokensUsed.toLocaleString()}{state.goal.tokenBudget !== null ? ` / ${state.goal.tokenBudget.toLocaleString()}` : ""}</dd>
        </dl>
      </> : <p className="text-[11px] text-muted-foreground">{state.failed ? "Goal details unavailable. Open the thread to inspect." : "No active goal."}</p>}
  </section>;
}
