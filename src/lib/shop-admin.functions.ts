import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireCloudAuth } from "@/lib/cloud-auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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

function getSignupClient() {
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

function cleanUsername(username: string) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean || clean.length < 2) throw new Error("Username must be 2+ chars (letters, numbers, . _ -)");
  return clean;
}

function assertStrongStaffPassword(password: string) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must include uppercase, lowercase, and a number");
  }
}

// Verify caller owns the tenant they operate on and return that tenant.
async function callerTenant(context: any): Promise<{ tenant_id: string; slug: string }> {
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

function internalEmail(username: string, slug: string) {
  const clean = cleanUsername(username);
  return `${clean}@shop-${slug}.local`;
}

function displayUsername(profileName: string | null | undefined, id: string) {
  const clean = profileName?.trim();
  return clean || `staff-${id.slice(0, 8)}`;
}

export const getMyShopInfo = createServerFn({ method: "GET" })
  .middleware([requireCloudAuth])
  .handler(async ({ context }) => {
    const { data: tid } = await context.supabase.rpc("current_tenant_id");
    if (!tid) return null;
    const { data: t } = await context.supabase
      .from("tenants")
      .select("id, name, slug, owner_id, status, plan")
      .eq("id", tid)
      .maybeSingle();
    if (!t) return null;
    return {
      tenant_id: t.id,
      name: t.name,
      code: t.slug,
      status: t.status,
      plan: t.plan,
      is_owner: t.owner_id === context.userId,
    };
  });



export const listShopStaff = createServerFn({ method: "GET" })
  .middleware([requireCloudAuth])
  .handler(async ({ context }) => {
    const { tenant_id } = await callerTenant(context);

    const { data: members, error } = await context.supabase
      .from("tenant_members")
      .select("user_id, role")
      .eq("tenant_id", tenant_id);
    if (error) throw error;

    const ids = (members ?? []).map((m) => m.user_id);
    if (!ids.length) return [];

    const [rolesRes, permsRes, profilesRes] = await Promise.all([
      context.supabase.from("user_roles").select("user_id, role").in("user_id", ids),
      context.supabase.from("user_permissions").select("user_id, perm").in("user_id", ids),
      context.supabase.from("profiles").select("id, full_name, created_at").in("id", ids),
    ]);
    if (rolesRes.error) throw rolesRes.error;
    if (permsRes.error) throw permsRes.error;
    if (profilesRes.error) throw profilesRes.error;

    const roles = rolesRes.data ?? [];
    const perms = permsRes.data ?? [];
    const profiles = profilesRes.data ?? [];

    return ids
      .map((id) => {
        const profile = profiles.find((p) => p.id === id);
        const role = roles.find((r) => r.user_id === id)?.role ?? "cashier";
        return {
          id,
          username: displayUsername(profile?.full_name, id),
          email: null,
          created_at: profile?.created_at ?? null,
          role,
          is_owner: id === context.userId,
          perms: perms.filter((p) => p.user_id === id).map((p) => p.perm),
        };
      })
      .filter(Boolean);
  });

export const createShopStaff = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { username: string; password: string; role: "admin" | "cashier"; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { slug } = await callerTenant(context);
    const username = cleanUsername(data.username);
    assertStrongStaffPassword(data.password);
    const email = internalEmail(username, slug);
    const signupClient = getSignupClient();

    const { data: created, error } = await signupClient.auth.signUp({
      email,
      password: data.password,
      options: { data: { full_name: username } },
    });
    if (error) {
      if ((error as any)?.code === "weak_password" || /weak/i.test(error.message)) {
        throw new Error("Password is too weak or common. Use a longer password with mixed characters.");
      }
      if (/already|registered|exists/i.test(error.message)) {
        throw new Error(`Username "${username}" already exists in this shop`);
      }
      throw new Error(error.message);
    }
    const uid = created.user?.id;
    const identities = (created.user as any)?.identities;
    if (!uid || (Array.isArray(identities) && identities.length === 0)) {
      throw new Error(`Username "${username}" already exists in this shop`);
    }

    const { error: finalizeError } = await context.supabase.rpc("shop_owner_finalize_staff", {
      _staff_user_id: uid,
      _username: username,
      _role: data.role,
      _perms: data.role === "cashier" ? data.perms : [],
    });
    if (finalizeError) throw new Error(finalizeError.message);

    return { id: uid, username };
  });

export const resetShopStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string; password: string }) => data)
  .handler(async ({ data, context }) => {
    const { tenant_id } = await callerTenant(context);
    assertStrongStaffPassword(data.password);

    const { data: m, error: memberError } = await context.supabase
      .from("tenant_members").select("user_id").eq("tenant_id", tenant_id).eq("user_id", data.user_id).maybeSingle();
    if (memberError) throw memberError;
    if (!m) throw new Error("This user is not part of your shop");

    throw new Error("Password reset is unavailable for staff accounts. Remove this staff member and create a new login with the new password.");
  });

export const setShopStaffPerms = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string; role: "admin" | "cashier"; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    await callerTenant(context);
    if (data.user_id === context.userId) throw new Error("You cannot change your own role");
    const { error } = await context.supabase.rpc("shop_owner_set_staff_access", {
      _staff_user_id: data.user_id,
      _role: data.role,
      _perms: data.role === "cashier" ? data.perms : [],
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteShopStaff = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string }) => data)
  .handler(async ({ data, context }) => {
    await callerTenant(context);
    if (data.user_id === context.userId) throw new Error("You cannot remove yourself");
    const { error } = await context.supabase.rpc("shop_owner_remove_staff", { _staff_user_id: data.user_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
