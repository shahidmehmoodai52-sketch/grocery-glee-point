import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseInput, resetTenantOwnerPasswordInput } from "@/lib/server-validators";

async function assertSuperAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (error || !data) throw new Error("Forbidden: super admin only");
}

async function assertAdminPerm(context: any, perm: string) {
  const { data, error } = await context.supabase.rpc("admin_has_perm", { _user_id: context.userId, _perm: perm });
  if (error || !data) throw new Error(`Forbidden: missing '${perm}' permission`);
}

/**
 * Reset the password for a tenant's owner. Super-admin only.
 */
export const resetTenantOwnerPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(resetTenantOwnerPasswordInput, data))
  .handler(async ({ data, context }) => {
    await assertAdminPerm(context, "shops.reset_password");
    if (!data.new_password || data.new_password.length < 6) {
      throw new Error("Password must be 6+ chars");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("owner_id, name")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!tenant?.owner_id) throw new Error("This shop has no owner assigned");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(tenant.owner_id, {
      password: data.new_password,
    });
    if (error) {
      if ((error as any)?.code === "weak_password" || /weak/i.test(error.message)) {
        throw new Error("Password is too weak or common. Use a longer password with mixed characters.");
      }
      throw new Error(error.message);
    }
    return { ok: true, shop: tenant.name };
  });
