import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuperAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (error || !data) throw new Error("Forbidden: super admin only");
}

export const listAdminStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: staff, error } = await supabaseAdmin
      .from("admin_staff")
      .select("user_id, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const ids = (staff ?? []).map((s) => s.user_id);
    if (ids.length === 0) return [];
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const { data: perms } = await supabaseAdmin
      .from("admin_staff_permissions")
      .select("user_id, perm")
      .in("user_id", ids);
    return (staff ?? []).map((s) => {
      const u = users?.users.find((x) => x.id === s.user_id);
      return {
        user_id: s.user_id,
        email: u?.email ?? "(unknown)",
        created_at: s.created_at,
        perms: (perms ?? []).filter((p) => p.user_id === s.user_id).map((p) => p.perm),
      };
    });
  });

export const addAdminStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (!data.email) throw new Error("Email required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const u = users?.users.find((x) => x.email?.toLowerCase() === data.email.toLowerCase());
    if (!u) throw new Error("No user found with that email. Ask them to sign up first.");
    const { error: e1 } = await supabaseAdmin
      .from("admin_staff")
      .upsert({ user_id: u.id, added_by: context.userId }, { onConflict: "user_id" });
    if (e1) throw e1;
    await supabaseAdmin.from("admin_staff_permissions").delete().eq("user_id", u.id);
    if (data.perms.length) {
      const rows = data.perms.map((p) => ({ user_id: u.id, perm: p, granted_by: context.userId }));
      const { error: e2 } = await supabaseAdmin.from("admin_staff_permissions").insert(rows);
      if (e2) throw e2;
    }
    return { ok: true, user_id: u.id };
  });

export const setAdminStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; perms: string[] }) => data)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_staff_permissions").delete().eq("user_id", data.user_id);
    if (data.perms.length) {
      const rows = data.perms.map((p) => ({ user_id: data.user_id, perm: p, granted_by: context.userId }));
      const { error } = await supabaseAdmin.from("admin_staff_permissions").insert(rows);
      if (error) throw error;
    }
    return { ok: true };
  });

export const removeAdminStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => data)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot remove yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("admin_staff").delete().eq("user_id", data.user_id);
    if (error) throw error;
    return { ok: true };
  });
