import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseInput, createStaffInput, resetPasswordInput, setStaffAccessInput, userIdInput } from "@/lib/server-validators";

type TenantMemberRole = "admin" | "cashier" | "manager" | "owner" | "staff" | "viewer";

/**
 * Tenant-scoped authorization for staff management.
 *
 * A caller may manage staff when they are an `owner`/`admin` member of a tenant
 * (tenant_members) — the same relationship used by usePermissions() and RLS.
 * Platform super admins keep their previous project-wide behaviour.
 */
async function resolveStaffAdmin(context: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: memberships, error } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", context.userId);
  if (error) throw error;

  const adminMembership = (memberships ?? []).find(
    (m) => m.role === "owner" || m.role === "admin",
  );

  const { data: isSuperAdmin } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });

  if (adminMembership?.tenant_id) {
    return {
      supabaseAdmin,
      tenantId: adminMembership.tenant_id as string,
      isSuperAdmin: Boolean(isSuperAdmin),
    };
  }

  if (isSuperAdmin) {
    return { supabaseAdmin, tenantId: null as string | null, isSuperAdmin: true };
  }

  throw new Error("Forbidden: admin only");
}

/** Ensure the target user is a member of the caller's tenant. */
async function assertSameTenant(
  supabaseAdmin: any,
  tenantId: string | null,
  targetUserId: string,
) {
  if (tenantId === null) return; // super admin, no tenant scope
  const { data, error } = await supabaseAdmin
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden: user belongs to another shop");
}

/**
 * Ensure the target user shares the caller-admin's tenant so RLS lets them
 * see products/customers/etc. that the admin uploaded. Removes any other
 * tenant memberships — current_tenant_id() returns NULL when count != 1.
 */
async function attachToTenant(
  supabaseAdmin: any,
  tenantId: string | null,
  targetUserId: string,
  memberRole: TenantMemberRole = "cashier",
  displayName?: string,
) {
  if (!tenantId) return;
  await supabaseAdmin.from("tenant_members").delete().eq("user_id", targetUserId);
  await supabaseAdmin.from("tenant_members").insert({
    user_id: targetUserId,
    tenant_id: tenantId,
    role: memberRole,
    ...(displayName ? { display_name: displayName } : {}),
  });
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, tenantId } = await resolveStaffAdmin(context);

    let allowedIds: string[] | null = null;
    let displayNames: Record<string, string | null> = {};
    if (tenantId) {
      const { data: members, error } = await supabaseAdmin
        .from("tenant_members")
        .select("user_id, display_name")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      allowedIds = (members ?? []).map((m: any) => m.user_id as string);
      displayNames = Object.fromEntries(
        (members ?? []).map((m: any) => [m.user_id, m.display_name ?? null]),
      );
      if (allowedIds.length === 0) return [];
    }

    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;

    const scoped = allowedIds
      ? users.users.filter((u) => allowedIds!.includes(u.id))
      : users.users;
    const ids = scoped.map((u) => u.id);
    if (ids.length === 0) return [];

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", ids);
    const { data: perms } = await supabaseAdmin.from("user_permissions").select("user_id,perm").in("user_id", ids);
    return scoped.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      role: (roles ?? []).find((r) => r.user_id === u.id)?.role ?? "cashier",
      perms: (perms ?? []).filter((p) => p.user_id === u.id).map((p) => p.perm),
      name: displayNames[u.id] ?? null,
    }));
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(createStaffInput, data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, tenantId } = await resolveStaffAdmin(context);
    if (!data.email || !data.password || data.password.length < 6) throw new Error("Email and 6+ char password required");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
    });
    if (error) throw error;
    const uid = created.user!.id;
    // handle_new_user trigger inserts a default role; overwrite with desired role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    if (data.role !== "admin" && data.perms.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.perms.map((p) => ({ user_id: uid, perm: p, granted_by: context.userId }))
      );
    }
    // Attach the new user to the caller's own tenant only.
    await attachToTenant(supabaseAdmin, tenantId, uid, data.role === "admin" ? "admin" : "cashier", data.name);
    return { id: uid };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(resetPasswordInput, data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, tenantId } = await resolveStaffAdmin(context);
    await assertSameTenant(supabaseAdmin, tenantId, data.user_id);
    if (!data.password || data.password.length < 6) throw new Error("Password must be 6+ chars");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw error;
    return { ok: true };
  });

export const setStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(setStaffAccessInput, data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, tenantId } = await resolveStaffAdmin(context);
    await assertSameTenant(supabaseAdmin, tenantId, data.user_id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    if (data.role !== "admin" && data.perms.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.perms.map((p) => ({ user_id: data.user_id, perm: p, granted_by: context.userId }))
      );
    }
    // Keep the user inside the caller's tenant so RLS lets them see shop data.
    await attachToTenant(supabaseAdmin, tenantId, data.user_id, data.role === "admin" ? "admin" : "cashier", data.name);
    return { ok: true };
  });

export const deleteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(userIdInput, data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, tenantId } = await resolveStaffAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot delete your own account");
    await assertSameTenant(supabaseAdmin, tenantId, data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw error;
    return { ok: true };
  });
