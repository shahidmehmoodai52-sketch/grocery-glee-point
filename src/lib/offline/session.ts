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
// one in-flight call across every caller removes the race within a tab
// regardless of which one fires first.
let refreshInFlight: Promise<unknown> | null = null;

// The in-flight guard above only spans one browser tab's own JS runtime —
// a shop that keeps two tabs of the same device open (not two different
// devices, which already get independent login sessions and can't race
// each other) shares the same underlying refresh token via localStorage
// (supabase-js's session store), so two tabs can still fire competing
// refreshSession() calls against it. Stamp a shared timestamp before
// calling so a second tab that checks within the same short window skips
// its own network call and just re-reads the session supabase-js already
// persisted to that shared storage — cheap, and avoids ever repeating the
// original failure mode across tabs instead of just within one.
const CROSS_TAB_LOCK_KEY = "tillix:last_refresh_attempt_at";
const CROSS_TAB_LOCK_WINDOW_MS = 5000;

export function refreshSessionDeduped(): Promise<unknown> {
  if (refreshInFlight) return refreshInFlight;

  let anotherTabRecentlyTried = false;
  try {
    const last = Number(window.localStorage.getItem(CROSS_TAB_LOCK_KEY) ?? 0);
    anotherTabRecentlyTried = Date.now() - last < CROSS_TAB_LOCK_WINDOW_MS;
    if (!anotherTabRecentlyTried) {
      window.localStorage.setItem(CROSS_TAB_LOCK_KEY, String(Date.now()));
    }
  } catch {
    /* localStorage unavailable — fall through to a normal refresh */
  }

  refreshInFlight = (anotherTabRecentlyTried ? supabase.auth.getSession() : supabase.auth.refreshSession())
    .catch(() => {/* no session yet, or already fresh — ignore */})
    .finally(() => { refreshInFlight = null; });
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

  // 3. No stored session at all. Offline, the cached user keeps the POS
  //    usable. Online, there is nothing to revalidate — the user signed out
  //    (or the session was revoked). Returning the cached user here is what
  //    sent a just-logged-out owner from /auth straight back into the app
  //    with no token, where my_tenant_status came back null and the
  //    "Register your shop" form appeared instead of the login page.
  if (!isEffectivelyOffline()) {
    clearCachedUser();
    return null;
  }
  return readCachedUser();
}

function clearCachedUser() {
  try {
    window.localStorage.removeItem(OFFLINE_USER_KEY);
  } catch {
    /* ignore */
  }
}

/** Sign out of this device, completely and quickly.
 *  - the cached offline user is dropped first, so nothing can resurrect the
 *    session while sign-out is in flight;
 *  - the server-side revoke gets a few seconds at most (on a slow
 *    connection supabase-js's signOut() could hang, which is why logout
 *    "didn't happen right away"); the local session is then removed no
 *    matter what. */
export async function signOutCompletely(): Promise<void> {
  clearCachedUser();
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    /* fall through to the local sign-out */
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* already signed out */
  }
  clearCachedUser();
}