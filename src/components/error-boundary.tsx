import { Component, type ErrorInfo, type ReactNode } from "react";
import { logAppError } from "@/lib/log-app-error";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  module?: string;
};

type State = { error: Error | null };

/**
 * Client-side React error boundary. Catches render-time exceptions in
 * descendant components, shows a friendly fallback, and logs technical
 * details to application_errors + Lovable telemetry. Never reveals stack
 * traces or database internals to the user.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error);
    reportLovableError(error, { boundary: "app_error_boundary" });
    void logAppError({
      errorType: "react_render",
      errorMessage: error.message || "React render error",
      stackTrace: (error.stack ?? "") + "\n\nComponentStack:" + (info.componentStack ?? ""),
      pageOrModule: this.props.module ?? (typeof window !== "undefined" ? window.location.pathname : null),
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This part of the app hit an unexpected error. You can try again or refresh the page.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={this.reset}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
