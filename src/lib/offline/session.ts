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
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      cacheUser(data.user);
      return data.user;
    }
  } catch {
    // If the network is gone, fall through to the locally persisted session.
  }

  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      cacheUser(data.session.user);
      return data.session.user;
    }
  } catch {
    // Ignore and use the last cached user only while the browser is offline.
  }

  return isOfflineNow() ? readCachedUser() : null;
}