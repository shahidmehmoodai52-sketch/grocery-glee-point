import { createServerFn } from "@tanstack/react-start";
import { requireCloudAuth } from "@/lib/cloud-auth-middleware";

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
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean || clean.length < 2) throw new Error("Username must be 2+ chars (letters, numbers, . _ -)");
  return `${clean}@shop-${slug}.local`;
}

function usernameFromEmail(email: string | null | undefined, slug: string) {
  if (!email) return "";
  const suffix = `@shop-${slug}.local`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
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
    const { tenant_id, slug } = await callerTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: members, error } = await supabaseAdmin
      .from("tenant_members")
      .select("user_id, role")
      .eq("tenant_id", tenant_id);
    if (error) throw error;

    const ids = (members ?? []).map((m) => m.user_id);
    if (!ids.length) return [];

    const [rolesRes, permsRes, ...userRes] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.from("user_permissions").select("user_id, perm").in("user_id", ids),
      ...ids.map((id) => supabaseAdmin.auth.admin.getUserById(id)),
    ]);
    const roles = rolesRes.data ?? [];
    const perms = permsRes.data ?? [];

    return ids
      .map((id, i) => {
        const u = (userRes[i] as any)?.data?.user;
        if (!u) return null;
        const role = roles.find((r) => r.user_id === id)?.role ?? "cashier";
        return {
          id,
          username: usernameFromEmail(u.email, slug),
          email: u.email,
          created_at: u.created_at,
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
    const { tenant_id, slug } = await callerTenant(context);
    if (!data.password || data.password.length < 6) throw new Error("Password must be 6+ chars");
    const email = internalEmail(data.username, slug);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Prevent duplicate username in the same shop
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (existing.users.some((u) => u.email === email)) {
      throw new Error(`Username "${data.username}" already exists in this shop`);
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw error;
    const uid = created.user!.id;

    // Override the default role/tenant assigned by handle_new_user trigger
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });

    if (data.role === "cashier" && data.perms.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.perms.map((p) => ({ user_id: uid, perm: p, granted_by: context.userId })),
      );
    }

    // Move into this tenant
    await supabaseAdmin.from("tenant_members").delete().eq("user_id", uid);
    await supabaseAdmin.from("tenant_members").insert({
      user_id: uid,
      tenant_id,
      role: data.role === "admin" ? "admin" : "cashier",
    });

    // The trigger may have auto-created a tenant for this new user — clean up.
    await supabaseAdmin.from("tenants").delete().eq("owner_id", uid).neq("id", tenant_id);

    return { id: uid, username: data.username };
  });

export const resetShopStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string; password: string }) => data)
  .handler(async ({ data, context }) => {
    const { tenant_id } = await callerTenant(context);
    if (!data.password || data.password.length < 6) throw new Error("Password must be 6+ chars");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: m } = await supabaseAdmin
      .from("tenant_members").select("user_id").eq("tenant_id", tenant_id).eq("user_id", data.user_id).maybeSingle();
    if (!m) throw new Error("This user is not part of your shop");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw error;
    return { ok: true };
  });

export const setShopStaffPerms = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string; role: "admin" | "cashier"; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { tenant_id } = await callerTenant(context);
    if (data.user_id === context.userId) throw new Error("You cannot change your own role");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: m } = await supabaseAdmin
      .from("tenant_members").select("user_id").eq("tenant_id", tenant_id).eq("user_id", data.user_id).maybeSingle();
    if (!m) throw new Error("This user is not part of your shop");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    if (data.role === "cashier" && data.perms.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.perms.map((p) => ({ user_id: data.user_id, perm: p, granted_by: context.userId })),
      );
    }
    await supabaseAdmin.from("tenant_members")
      .update({ role: data.role === "admin" ? "admin" : "cashier" })
      .eq("tenant_id", tenant_id).eq("user_id", data.user_id);
    return { ok: true };
  });

export const deleteShopStaff = createServerFn({ method: "POST" })
  .middleware([requireCloudAuth])
  .inputValidator((data: { user_id: string }) => data)
  .handler(async ({ data, context }) => {
    const { tenant_id } = await callerTenant(context);
    if (data.user_id === context.userId) throw new Error("You cannot remove yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: m } = await supabaseAdmin
      .from("tenant_members").select("user_id").eq("tenant_id", tenant_id).eq("user_id", data.user_id).maybeSingle();
    if (!m) throw new Error("This user is not part of your shop");

    // Only delete auth user if their email is an internal shop staff email.
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const target = users.users.find((u) => u.id === data.user_id);
    const isInternal = target?.email?.endsWith(".local") ?? false;

    await supabaseAdmin.from("tenant_members").delete().eq("user_id", data.user_id).eq("tenant_id", tenant_id);
    if (isInternal) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
      if (error) throw error;
    }
    return { ok: true };
  });
