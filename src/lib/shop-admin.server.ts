import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function callerTenant(context: any): Promise<{ tenant_id: string; slug: string }> {
  const { data: tid, error: e1 } = await context.supabase.rpc("current_tenant_id");
  if (e1 || !tid) throw new Error("No shop found for your account");
  const { data: t, error: e2 } = await context.supabase
    .from("tenants")
    .select("id, slug, owner_id")
    .eq("id", tid)
    .maybeSingle();
  if (e2 || !t) throw new Error("Shop not found");
  if (t.owner_id !== context.userId) throw new Error("Only the shop owner can manage staff");
  if (!t.slug) throw new Error("Shop code missing — contact support");
  return { tenant_id: t.id, slug: t.slug };
}

export function cleanUsername(username: string) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean || clean.length < 2) throw new Error("Username must be 2+ chars (letters, numbers, . _ -)");
  return clean;
}

export function internalEmail(username: string, slug: string) {
  return `${cleanUsername(username)}@shop-${slug}.local`;
}

export function displayUsername(profileName: string | null | undefined, id: string) {
  const clean = profileName?.trim();
  return clean || `staff-${id.slice(0, 8)}`;
}

export function assertStrongStaffPassword(password: string) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must include uppercase, lowercase, and a number");
  }
}

function isNewApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createBackendFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, header) => headers.set(header, value));
    }

    if (isNewApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

export function getSignupClient() {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Backend configuration is missing. Please refresh Lovable Cloud and retry.");
  }

  return createClient<Database>(url, publishableKey, {
    global: { fetch: createBackendFetch(publishableKey) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}