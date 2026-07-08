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

/** Check if the current visitor (by IP) or a given email is on the blocklist. */
export async function isBlocked(email?: string | null): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_blocked", {
      _email: email ?? undefined,
    });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}
