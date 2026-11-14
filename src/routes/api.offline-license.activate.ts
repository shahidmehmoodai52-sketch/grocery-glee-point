// POST /api/offline-license/activate — first start of the offline desktop
// edition (needs internet once). The shop owner signs in with their Tillix
// account; if their shop is active, this returns a license for that PC (valid
// until the shop's current subscription/trial ends) plus the shop details the
// exe uses to set up its local database.
import { createFileRoute } from "@tanstack/react-router";
import { anonClient, clientForToken, json, normalizeMachineId, signLicense } from "@/lib/offline-license.server";

const FALLBACK_DAYS = 7;

export const Route = createFileRoute("/api/offline-license/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); } catch { return json(400, { error: "Invalid request" }); }
        let machineId: string;
        try { machineId = normalizeMachineId(body?.machineId); } catch (e: any) { return json(400, { error: e.message }); }
        const email = String(body?.email ?? "").trim().toLowerCase();
        const password = String(body?.password ?? "");
        if (!email || !password) return json(400, { error: "Email and password are required" });

        const { data: auth, error: authErr } = await anonClient().auth.signInWithPassword({ email, password });
        if (authErr || !auth.session) {
          const notConfirmed = (authErr as any)?.code === "email_not_confirmed";
          return json(401, { error: notConfirmed ? "Email not confirmed yet — open the confirmation link first." : "Invalid email or password" });
        }
        const db = clientForToken(auth.session.access_token);
        try {
          const { data: status } = await db.rpc("my_tenant_status");
          if (!status) return json(403, { error: "No shop is registered on this account. Register your shop on tillix.co first." });
          if (status !== "active") {
            const why: Record<string, string> = {
              pending: "Your shop is waiting for approval.",
              suspended: "Your shop is suspended. Contact Tillix support.",
              archived: "Your shop is archived. Contact Tillix support.",
              expired: "Your subscription has expired. Contact Tillix support to renew.",
            };
            return json(403, { error: why[String(status)] ?? `Shop status: ${status}` });
          }
          const { data: tid } = await db.rpc("current_tenant_id");
          const { data: tenant } = await db.from("tenants").select("id, name, owner_id, business_type, shop_code").eq("id", tid as string).maybeSingle();
          if (!tenant) return json(403, { error: "Shop not found" });
          if (tenant.owner_id !== auth.user.id) return json(403, { error: "Only the shop owner can activate the offline edition." });
          const { data: settings } = await db.from("store_settings").select("store_name, phone, address, timezone, currency, currency_symbol").eq("tenant_id", tenant.id).maybeSingle();
          const { data: expiresAt } = await db.rpc("my_tenant_expires_at" as any);
          const expSec = expiresAt
            ? Math.floor(new Date(expiresAt as unknown as string).getTime() / 1000)
            : Math.floor(Date.now() / 1000) + FALLBACK_DAYS * 86400;
          const { code, payload } = signLicense({
            kind: "activation", tid: tenant.id, shop: tenant.name, sc: (tenant as any).shop_code ?? null,
            em: email, mid: machineId, exp: expSec,
          });
          return json(200, {
            license: code,
            expiresAt: new Date(payload.exp * 1000).toISOString(),
            shop: {
              id: tenant.id, name: tenant.name, businessType: tenant.business_type ?? "grocery",
              shopCode: (tenant as any).shop_code ?? null, ownerName: (auth.user.user_metadata as any)?.full_name ?? null,
              settings: settings ?? null,
            },
          });
        } catch (e: any) {
          return json(500, { error: e?.message ?? "Activation failed" });
        } finally {
          await db.auth.signOut().catch(() => {});
        }
      },
    },
  },
});
