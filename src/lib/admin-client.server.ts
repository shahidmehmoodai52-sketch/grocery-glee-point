// Server-only Supabase admin client with resilient env resolution.
// Falls back across common env var names in case the primary ones aren't
// populated in the current runtime (dev/worker/nitro contexts).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createAdminFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (isNewApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

function readEnv(name: string): string | undefined {
  // process.env — primary source in Node/SSR runtimes
  const fromProc = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (fromProc) return fromProc;
  // globalThis fallback (some runtimes stash env there)
  const g = globalThis as any;
  if (g?.[name]) return g[name];
  if (g?.env?.[name]) return g.env[name];
  // Vite import.meta.env with VITE_ prefix for the URL (never for secrets in the client bundle,
  // but this file is server-only per its `.server.ts` filename, so it's not shipped).
  try {
    const meta = (import.meta as any)?.env;
    if (meta?.[name]) return meta[name];
    if (name === "SUPABASE_URL" && meta?.VITE_SUPABASE_URL) return meta.VITE_SUPABASE_URL;
  } catch { /* noop */ }
  return undefined;
}

let cached: ReturnType<typeof createClient<Database>> | undefined;

export function getSupabaseAdmin() {
  if (cached) return cached;
  const url = readEnv("SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!serviceKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    throw new Error(
      `Backend admin config missing (${missing.join(", ")}). Please refresh Lovable Cloud and try again.`,
    );
  }
  cached = createClient<Database>(url, serviceKey, {
    global: { fetch: createAdminFetch(serviceKey) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
