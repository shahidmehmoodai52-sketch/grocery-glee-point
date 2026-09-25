import { supabase } from "@/integrations/supabase/client";

/** Fire-and-forget: record a security event. Never throws. */
export async function logSecurityEvent(
  eventType: string,
  opts: {
    severity?: "info" | "warning" | "critical";
    email?: string | null;
    path?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {},
): Promise<void> {
  try {
    await supabase.rpc("log_security_event", {
      _event_type: eventType,
      _severity: opts.severity ?? "info",
      _email: opts.email ?? undefined,
      _path:
        opts.path ??
        (typeof window !== "undefined" ? window.location.pathname : undefined),
      _metadata: (opts.metadata ?? undefined) as never,
    });
  } catch {
    // logging must never break the app
  }
}

/** Check if the current visitor (by IP) or a given email is on the blocklist.
 *  This gates sign-in (see auth.tsx) — if the proxy/network hangs instead of
 *  erroring outright (seen live: a degraded connection that neither
 *  succeeds nor fails, just never resolves), an un-timed-out call here would
 *  leave the login button spinning forever with no way in, even though the
 *  actual sign-in request would have worked fine. Fail open (treat as "not
 *  blocked") after a bounded wait rather than block every login on this
 *  check being reachable. */
export async function isBlocked(email?: string | null): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const { data, error } = await supabase
      .rpc("is_blocked", { _email: email ?? undefined })
      .abortSignal(ctrl.signal);
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
