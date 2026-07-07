import { supabase } from "@/integrations/supabase/client";

export type LogAppErrorInput = {
  errorType: string;
  errorMessage: string;
  stackTrace?: string | null;
  pageOrModule?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Fire-and-forget error logger. Persists to public.application_errors via
 * SECURITY DEFINER RPC. Never throws — logging must not itself break the app.
 * SSR-safe: no-op on the server.
 */
export async function logAppError(input: LogAppErrorInput): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await supabase.rpc("log_application_error", {
      _error_type: (input.errorType ?? "unknown").slice(0, 200),
      _error_message: (input.errorMessage ?? "unspecified error").slice(0, 2000),
      _stack_trace: input.stackTrace ? input.stackTrace.slice(0, 8000) : undefined,
      _page_or_module:
        input.pageOrModule ??
        (typeof window !== "undefined" ? window.location.pathname : undefined),
      _metadata: (input.metadata ?? undefined) as never,
    });
  } catch {
    // swallow — logger must never break the app
  }
}

/** Convert a thrown value into a safe user-facing message (no PII, no SQL). */
export function friendlyErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const raw = error instanceof Error ? error.message : String(error);
  // Strip anything that looks like a Postgres/PostgREST internal hint.
  if (/duplicate key|violates|permission denied|row-level security|JWT|relation .* does not exist/i.test(raw)) {
    return fallback;
  }
  // Length-cap so raw driver noise never reaches the UI.
  return raw.length > 200 ? fallback : raw;
}
