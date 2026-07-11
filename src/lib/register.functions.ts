import { createServerFn } from "@tanstack/react-start";

/**
 * Public server function: register a brand-new shop with an owner account
 * that signs in with username + password (no email required).
 *
 * Internal email is `<username>@shop-<slug>.local` and is never shown to users.
 */
export const registerShopAccount = createServerFn({ method: "POST" })
  .inputValidator((data: {
    shop_name: string;
    username: string;
    password: string;
    full_name?: string;
    phone?: string;
    address?: string;
    city?: string;
  }) => data)
  .handler(async ({ data }) => {
    const shop_name = (data.shop_name ?? "").trim();
    const username = (data.username ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const password = data.password ?? "";
    if (shop_name.length < 2) throw new Error("Shop name is required");
    if (username.length < 2) throw new Error("Username must be 2+ characters (letters, numbers, . _ -)");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reserve a unique slug for this shop
    const { data: slugData, error: slugErr } = await supabaseAdmin.rpc("gen_tenant_slug", { _seed: shop_name });
    if (slugErr || !slugData) throw new Error(slugErr?.message ?? "Could not generate shop code");
    const slug = String(slugData);

    const email = `${username}@shop-${slug}.local`;

    // Refuse duplicate username within same shop (slug is unique, so effectively globally)
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (existing.users.some((u) => u.email === email)) {
      throw new Error(`Username "${username}" is already taken. Try another.`);
    }

    // Create the auth user — the handle_new_user trigger will auto-create a tenant for them
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name ?? username, username },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "Could not create account");
    const uid = created.user.id;

    // Update the auto-created tenant with shop details + slug
    const { data: existingTenant } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("owner_id", uid)
      .maybeSingle();

    let tenantId: string;
    if (existingTenant?.id) {
      tenantId = existingTenant.id;
      await supabaseAdmin
        .from("tenants")
        .update({ name: shop_name, slug, status: "pending" })
        .eq("id", tenantId);
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("tenants")
        .insert({ name: shop_name, owner_id: uid, slug, status: "pending" })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "Could not create shop");
      tenantId = inserted.id;
      await supabaseAdmin.from("tenant_members").insert({ tenant_id: tenantId, user_id: uid, role: "owner" });
    }

    // Save shop contact details in store_settings
    await supabaseAdmin
      .from("store_settings")
      .upsert({
        tenant_id: tenantId,
        store_name: shop_name,
        phone: data.phone ?? null,
        address: [data.address, data.city].filter(Boolean).join(", ") || null,
      }, { onConflict: "tenant_id" });

    return { slug, email };
  });
