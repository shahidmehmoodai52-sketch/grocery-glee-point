import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error || !data) throw new Error("Forbidden: admin only");
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;
    const ids = users.users.map((u) => u.id);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", ids);
    const { data: perms } = await supabaseAdmin.from("user_permissions").select("user_id,perm").in("user_id", ids);
    return users.users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      role: (roles ?? []).find((r) => r.user_id === u.id)?.role ?? "cashier",
      perms: (perms ?? []).filter((p) => p.user_id === u.id).map((p) => p.perm),
    }));
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; password: string; role: "admin" | "cashier"; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.email || !data.password || data.password.length < 6) throw new Error("Email and 6+ char password required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    return { id: uid };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; password: string }) => data)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.password || data.password.length < 6) throw new Error("Password must be 6+ chars");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw error;
    return { ok: true };
  });

export const setStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; role: "admin" | "cashier"; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    if (data.role !== "admin" && data.perms.length) {
      await supabaseAdmin.from("user_permissions").insert(
        data.perms.map((p) => ({ user_id: data.user_id, perm: p, granted_by: context.userId }))
      );
    }
    return { ok: true };
  });

export const deleteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => data)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot delete your own account");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw error;
    return { ok: true };
  });
