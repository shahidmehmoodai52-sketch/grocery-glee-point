import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

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
  return typeof navigator !== "undefined" && navigator.onLine === false;
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