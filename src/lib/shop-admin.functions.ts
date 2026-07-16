import { createServerFn } from "@tanstack/react-start";
import { requireCloudAuth } from "@/lib/cloud-auth-middleware";
import {
  assertStrongStaffPassword,
  callerTenant,
  cleanUsername,
  displayUsername,
  getSignupClient,
  internalEmail,
} from "@/lib/shop-admin.server";

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
