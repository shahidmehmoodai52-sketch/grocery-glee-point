export type AdminErrorRow = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  error_type: string;
  error_message: string;
  page_or_module: string | null;
  stack_trace: string | null;
  created_at: string;
};

/**
 * Attempts one known, real recovery action for sync/offline-queue errors
 * (re-running the offline sync queue) and reports whether it actually ran.
 * Every other category is a categorization only, not a fix — this never
 * claims to have "auto-fixed" a real code bug, and only the sync branch is
 * ever auto-resolved; everything else is left for the admin to confirm.
 */
export async function autoRemediate(row: AdminErrorRow): Promise<{ note: string; autoResolved: boolean }> {
  const type = (row.error_type ?? "").toLowerCase();
  try {
    if (type.includes("sync") || type.includes("offline") || type.includes("queue")) {
      const mod = await import("@/lib/offline/sync");
      const fn = (mod as any).syncNow ?? (mod as any).runSync ?? (mod as any).default;
      if (typeof fn === "function") {
        await fn();
        return { note: "Re-ran offline sync queue", autoResolved: true };
      }
      return { note: "No sync runner available — needs manual review", autoResolved: false };
    }
    if (type.includes("cache") || type.includes("stale") || type.includes("query")) {
      return { note: "Likely a stale client cache — reload should clear it", autoResolved: false };
    }
    if (type.includes("render") || type.includes("react") || type.includes("hydration")) {
      return { note: "Rendering error — user should reload the affected page", autoResolved: false };
    }
    if (type.includes("network") || type.includes("fetch") || type.includes("timeout")) {
      return { note: "Looks like a transient network error", autoResolved: false };
    }
    return { note: "No known automatic recovery for this error type", autoResolved: false };
  } catch (e: any) {
    return { note: `Recovery attempt failed: ${e?.message ?? "unknown"}`, autoResolved: false };
  }
}
