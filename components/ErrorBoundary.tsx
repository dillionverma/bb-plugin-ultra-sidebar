import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What to show instead — bb's own thread list, bound to this instance. */
  fallback: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * Keeps a bug in the workspace tree from costing the user their sidebar.
 *
 * Without this, any throw here means bb silently swaps in its own list, so a
 * data bug looks like the plugin vanishing. With it, the user gets bb's list
 * plus a line saying what happened.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[workspace-sidebar] thread list crashed", error, info);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          Workspaces failed to render: {this.state.message}
        </p>
        <div className="min-h-0 flex-1">{this.props.fallback}</div>
      </div>
    );
  }
}
