// Local HTTP API — mirrors Supabase RPCs (complete_sale, complete_purchase, returns, payments)
// Renderer's supabase-adapter (src/integrations/supabase/client.ts in desktop mode) calls these.
// Listens on 0.0.0.0 so cashier PCs on LAN can hit it.
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'pos-local-jwt-please-change-in-config';

async function start({ port, pgConnection }) {
  const pool = new Pool(pgConnection);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ---- Auth (PIN) ----
  app.post('/auth/login', async (req, reply) => {
    const { user_id, pin } = req.body || {};
    const { rows } = await pool.query(
      'SELECT id, name, role, pin_hash FROM app_users WHERE id=$1 AND is_active=true',
      [user_id]
    );
    const u = rows[0];
    if (!u || !bcrypt.compareSync(String(pin ?? ''), u.pin_hash)) {
      return reply.code(401).send({ error: 'Invalid PIN' });
    }
    const token = jwt.sign({ sub: u.id, name: u.name, role: u.role }, JWT_SECRET, { expiresIn: '12h' });
    return { token, user: { id: u.id, name: u.name, role: u.role } };
  });

  app.get('/auth/users', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, role FROM app_users WHERE is_active=true ORDER BY name'
    );
    return rows;
  });

  // Auth middleware
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/auth/')) return;
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'No token' });
    try { req.user = jwt.verify(token, JWT_SECRET); }
    catch { return reply.code(401).send({ error: 'Bad token' }); }
  });

  // ---- Generic table CRUD (mirrors PostgREST subset the app uses) ----
  // GET  /table/:name?select=...&col=eq.value&order=col.desc&limit=100
  // POST /table/:name          (insert)
  // PATCH /table/:name?...     (update)
  // DELETE /table/:name?...    (delete)
  const { registerTableRoutes } = require('./api-tables.cjs');
  registerTableRoutes(app, pool);

  // ---- RPCs (identical bodies to Supabase functions, called with jsonb payload) ----
  const { registerRpcRoutes } = require('./api-rpcs.cjs');
  registerRpcRoutes(app, pool);

  await app.listen({ port, host: '0.0.0.0' });
  return { close: () => app.close(), pool };
}

module.exports = { start };
