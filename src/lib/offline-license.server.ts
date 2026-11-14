// Signs license codes for the offline desktop edition (desktop-offline/).
// Format and checks must match desktop-offline/runtime/license.cjs:
//   TLX1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>
// The private key comes only from the TILLIX_LICENSE_PRIVATE_KEY environment
// variable (PEM, or base64 of the PEM); it is never shipped to a browser or
// the exe. The exe verifies with the matching public key it carries.
import { createClient } from "@supabase/supabase-js";
import { randomUUID, sign as edSign, createPrivateKey } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

export type LicensePayload = {
  v: 1;
  kind: "activation" | "renewal";
  lid: string;
  tid: string;
  shop: string;
  sc: string | null;
  em: string | null;
  mid: string;
  iat: number;
  exp: number;
};

const MACHINE_ID = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeMachineId(raw: unknown): string {
  const id = String(raw ?? "").trim().toUpperCase();
  if (!MACHINE_ID.test(id)) throw new Error("Machine ID must look like ABCD-EFGH-JKLM");
  return id;
}

function privateKey() {
  const raw = process.env.TILLIX_LICENSE_PRIVATE_KEY;
  if (!raw) throw new Error("Offline licensing is not configured on the server (TILLIX_LICENSE_PRIVATE_KEY missing)");
  const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return createPrivateKey(pem);
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signLicense(p: Omit<LicensePayload, "v" | "lid" | "iat"> & { iat?: number }): { code: string; payload: LicensePayload } {
  const payload: LicensePayload = { v: 1, lid: randomUUID(), iat: Math.floor(Date.now() / 1000), ...p } as LicensePayload;
  const head = `TLX1.${b64url(JSON.stringify(payload))}`;
  const sig = edSign(null, Buffer.from(head), privateKey());
  return { code: `${head}.${b64url(sig)}`, payload };
}

function supabaseEnv() {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Backend configuration is missing");
  return { url, key };
}

/** A client acting as the signed-in user (RLS applies), from their access token. */
export function clientForToken(accessToken: string) {
  const { url, key } = supabaseEnv();
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient() {
  const { url, key } = supabaseEnv();
  return createClient<Database>(url, key, { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } });
}

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
