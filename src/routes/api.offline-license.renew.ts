// POST /api/offline-license/renew — Tillix super admin only. Issues a
// renewal code for one shop's offline PC (by Machine ID) with a new expiry.
// The shop pastes it into the exe's renewal screen.
import { createFileRoute } from "@tanstack/react-router";
import { clientForToken, json, normalizeMachineId, signLicense } from "@/lib/offline-license.server";

const MAX_DAYS = 3 * 366;

export const Route = createFileRoute("/api/offline-license/renew")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
        if (!token) return json(401, { error: "Sign in to the admin panel first" });
        let body: any;
        try { body = await request.json(); } catch { return json(400, { error: "Invalid request" }); }

        const db = clientForToken(token);
        const { data: isAdmin, error: adminErr } = await db.rpc("am_i_super_admin");
        if (adminErr || !isAdmin) return json(403, { error: "Only a Tillix super admin can issue renewal codes" });

        let machineId: string;
        try { machineId = normalizeMachineId(body?.machineId); } catch (e: any) { return json(400, { error: e.message }); }
        const tenantId = String(body?.tenantId ?? "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return json(400, { error: "Pick the shop" });
        const exp = Math.floor(new Date(String(body?.expiresAt ?? "")).getTime() / 1000);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(exp) || exp <= now) return json(400, { error: "Expiry must be a future date" });
        if (exp - now > MAX_DAYS * 86400) return json(400, { error: "Expiry can be at most 3 years ahead" });

        const { data: tenant } = await db.from("tenants").select("id, name, shop_code").eq("id", tenantId).maybeSingle();
        if (!tenant) return json(404, { error: "Shop not found" });
        const { code, payload } = signLicense({
          kind: "renewal", tid: tenant.id, shop: tenant.name, sc: (tenant as any).shop_code ?? null,
          em: null, mid: machineId, exp,
        });
        await db.rpc("log_admin_action" as any, {
          _action: "OFFLINE_LICENSE_RENEW", _tenant_id: tenant.id, _entity_type: "tenant", _entity_id: tenant.id,
          _reason: `Offline license for ${machineId} until ${new Date(exp * 1000).toISOString().slice(0, 10)}`,
        }).then(() => {}, () => {});
        return json(200, { code, shop: tenant.name, shopCode: (tenant as any).shop_code ?? null, machineId, expiresAt: new Date(payload.exp * 1000).toISOString() });
      },
    },
  },
});
