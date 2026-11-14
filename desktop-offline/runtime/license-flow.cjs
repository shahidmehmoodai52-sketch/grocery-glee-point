// Activation (once, online) and applying the license to the local database.
'use strict';

const license = require('./license.cjs');

const CLOUD_URL = (process.env.TILLIX_CLOUD_URL || 'https://tillix.co').replace(/\/$/, '');

/** Ask tillix.co for a license for this PC, then create the same owner
 *  account and shop in the local database so the owner signs in with the
 *  email/password they already know. */
async function activateOnline({ backend, dataDir, email, password }) {
  const machineId = license.machineId();
  let res;
  try {
    res = await fetch(`${CLOUD_URL}/api/offline-license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, machineId }),
    });
  } catch {
    throw new Error('Could not reach tillix.co. Activation needs internet once — check the connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.license) throw new Error(body.error || `Activation failed (${res.status})`);

  const payload = license.install(dataDir, body.license);
  await ensureLocalShop(backend, { email, password, shop: body.shop });
  await applyLicenseToDb(backend, payload);
  return payload;
}

/** Owner account + shop in the local DB (idempotent: re-activation on the
 *  same PC reuses them, and refreshes the password to the one just used). */
async function ensureLocalShop(backend, { email, password, shop }) {
  const gw = backend.url;
  const headers = { apikey: backend.anonKey, 'Content-Type': 'application/json' };
  const call = async (path, body, token) => {
    const r = await fetch(gw + path, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token || backend.anonKey}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const lower = String(email).trim().toLowerCase();
  const existing = await backend.query('SELECT id FROM auth.users WHERE lower(email) = $1', [lower]);
  if (existing.length) {
    await backend.query("UPDATE auth.users SET encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() WHERE id = $1", [existing[0].id, password]);
  } else {
    const r = await call('/auth/v1/signup', { email: lower, password, data: { full_name: shop.ownerName || shop.name } });
    if (r.status !== 200) throw new Error((r.body && (r.body.msg || r.body.error)) || 'Could not create the local account');
  }
  const login = await call('/auth/v1/token?grant_type=password', { email: lower, password });
  if (login.status !== 200) throw new Error('Could not sign in to the local database');
  const token = login.body.access_token;
  const s = shop.settings || {};
  const reg = await call('/rest/v1/rpc/register_shop', {
    _name: shop.name, _phone: s.phone || null, _address: s.address || null, _city: null,
    _business_type: shop.businessType || 'grocery',
  }, token);
  if (reg.status !== 200) throw new Error((reg.body && reg.body.message) || 'Could not set up the shop locally');
  const tenantId = reg.body;
  // Same shop code as online, so invoice numbers look the same (S-044-1001…).
  if (shop.shopCode) await backend.query('UPDATE public.tenants SET shop_code = $2 WHERE id = $1', [tenantId, shop.shopCode]);
  if (s.timezone || s.currency || s.currency_symbol || s.store_name) {
    await backend.query(
      `UPDATE public.store_settings SET
         timezone = COALESCE($2, timezone), currency = COALESCE($3, currency),
         currency_symbol = COALESCE($4, currency_symbol), store_name = COALESCE($5, store_name)
       WHERE tenant_id = $1`,
      [tenantId, s.timezone || null, s.currency || null, s.currency_symbol || null, s.store_name || null],
    );
  }
}

/** Make the app's own subscription checks follow the license: every shop in
 *  the local DB is active until the license expiry. (The app shows its usual
 *  "N days left" banner from this; the license itself is enforced in main.) */
async function applyLicenseToDb(backend, payload) {
  const exp = new Date(payload.exp * 1000).toISOString();
  await backend.query("UPDATE public.tenants SET status = 'active' WHERE status <> 'active'");
  await backend.query(
    `UPDATE public.tenant_subscriptions SET expires_at = $1, status = 'active', updated_at = now()
      WHERE id IN (SELECT DISTINCT ON (tenant_id) id FROM public.tenant_subscriptions ORDER BY tenant_id, started_at DESC)`,
    [exp],
  );
  await backend.query(
    `INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
     SELECT t.id, (SELECT id FROM public.subscription_plans WHERE name = 'Pro' LIMIT 1), 'active', now(), $1
       FROM public.tenants t
      WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions s WHERE s.tenant_id = t.id)`,
    [exp],
  );
}

module.exports = { activateOnline, applyLicenseToDb, CLOUD_URL };
