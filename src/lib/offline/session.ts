import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { isEffectivelyOffline } from "./status";

const OFFLINE_USER_KEY = "tillix_offline_auth_user";

function cacheUser(user: User) {
  try {
    window.localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(user));
  } catch {
    // Best effort only.
  }
}

function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(OFFLINE_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function isOfflineNow(): boolean {
  return isEffectivelyOffline();
}

// Several independent triggers (reconnect, tab focus, a failed tenant-status
// check) each want to force-refresh the session so a stale/expired access
// token never causes a genuine action to fail. Left uncoordinated, two of
// them firing within milliseconds of each other (a flapping network
// interface commonly brings a reconnect and a focus change at once) race
// two refreshSession() calls against the same not-yet-rotated refresh
// token — one succeeds, the other is rejected as already-used, and that
// rejection can tear down the session the first call just established. A
// spurious sign-out on reconnect, not an actually-expired session. Sharing
// one in-flight call across every caller removes the race regardless of
// which one fires first.
let refreshInFlight: Promise<unknown> | null = null;
export function refreshSessionDeduped(): Promise<unknown> {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession()
      .catch(() => {/* no session yet, or already fresh — ignore */})
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function getUserAllowOffline(): Promise<User | null> {
  // 1. Prefer local session first — Supabase restores this from storage reliably
  //    and does not need a network round-trip. This prevents transient network
  //    hiccups from logging a valid user out.
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      cacheUser(data.session.user);
      return data.session.user;
    }
  } catch {
    // Storage/session not ready yet — fall through to network revalidation.
  }

  // 2. If no local session, try network revalidation.
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      cacheUser(data.user);
      return data.user;
    }
  } catch {
    // Network or server error — fall through to cached fallback.
  }

  // 3. Last resort: use the cached user even if we are not strictly offline,
  //    so a transient network glitch does not force a logout.
  return readCachedUser();
}