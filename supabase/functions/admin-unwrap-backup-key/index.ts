// Admin-panel backup recovery: unwraps the small RSA-OAEP-wrapped AES
// content key from a shop's `.tlxbak` local-backup file (src/lib/backup.ts /
// src/lib/backup-crypto.ts), so Tillix support can recover a backup if the
// shop lost its own recovery key. Never sees or needs the shop's actual
// backup contents -- only the ~256-byte wrapped-key blob the admin panel
// extracts client-side and sends here.
//
// Tillix's RSA-OAEP PRIVATE key lives only as this function's
// BACKUP_ADMIN_PRIVATE_KEY_JWK secret -- never in any client bundle, never
// in a migration, never logged. Every successful unwrap is written to
// admin_action_log via the existing log_admin_action() RPC, using the
// caller's own JWT so auth.uid() attributes it to the actual admin.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PRIVATE_KEY_JWK = Deno.env.get("BACKUP_ADMIN_PRIVATE_KEY_JWK");

const ADMIN_WRAP_LEN = 256; // RSA-OAEP-2048 output is always exactly this size

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!PRIVATE_KEY_JWK) {
    console.error("admin-unwrap-backup-key: BACKUP_ADMIN_PRIVATE_KEY_JWK secret not configured");
    return json({ error: "Backup recovery is not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Not authenticated" }, 401);
  }

  let body: { wrappedKeyBase64?: string; reason?: string; fileName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const reason = (body.reason ?? "").trim();
  if (!reason) {
    return json({ error: "A reason is required to recover a backup" }, 400);
  }
  const wrappedKeyBase64 = body.wrappedKeyBase64 ?? "";
  let wrappedBytes: Uint8Array;
  try {
    wrappedBytes = base64ToBytes(wrappedKeyBase64);
  } catch {
    return json({ error: "Invalid backup file" }, 400);
  }
  if (wrappedBytes.length !== ADMIN_WRAP_LEN) {
    return json({ error: "Invalid backup file" }, 400);
  }

  // Evaluate every check as the calling user (their JWT, not service role),
  // so is_super_admin/log_admin_action attribute correctly via auth.uid().
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isSuperAdmin, error: permError } = await supabase.rpc("am_i_super_admin");
  if (permError || !isSuperAdmin) {
    return json({ error: "Forbidden" }, 403);
  }

  let rawK: Uint8Array;
  try {
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(PRIVATE_KEY_JWK),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrappedBytes);
    rawK = new Uint8Array(decrypted);
  } catch (e) {
    console.error("admin-unwrap-backup-key: decrypt failed", e);
    return json({ error: "Could not recover this backup file" }, 400);
  }

  const { error: logError } = await supabase.rpc("log_admin_action", {
    _action: "BACKUP_RECOVER",
    _reason: reason,
    _metadata: body.fileName ? { file_name: body.fileName } : null,
  });
  if (logError) {
    // Don't hand back a decrypted key for an action we failed to audit.
    console.error("admin-unwrap-backup-key: log_admin_action failed", logError);
    return json({ error: "Could not record this recovery — try again" }, 500);
  }

  return json({ ok: true, key: bytesToBase64(rawK) });
});
