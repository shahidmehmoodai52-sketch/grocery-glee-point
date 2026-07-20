import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { isOfflineNow } from "@/lib/offline/session";

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem("device_id");
    if (existing) return existing;
    const id: string = (crypto as any).randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("device_id", id);
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
}

/**
 * Registers this device as an active session for the signed-in user and
 * heartbeats every 30s. Admin panel counts rows with recent last_seen.
 */
export function useSessionHeartbeat() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    const device_id = getDeviceId();
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    const beat = async () => {
      if (isOfflineNow()) return;
      await supabase
        .from("user_sessions")
        .upsert(
          { user_id: user.id, device_id, user_agent: ua, last_seen: new Date().toISOString() },
          { onConflict: "user_id,device_id" }
        );
    };
    beat();
    const interval = setInterval(beat, 30_000);

    const cleanup = async () => {
      try {
        if (isOfflineNow()) return;
        await supabase.from("user_sessions").delete().eq("user_id", user.id).eq("device_id", device_id);
      } catch {}
    };
    const onUnload = () => { void cleanup(); };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
      void cleanup();
    };
  }, [user?.id]);
}
