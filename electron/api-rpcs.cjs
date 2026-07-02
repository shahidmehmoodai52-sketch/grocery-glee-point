// RPC endpoints — thin wrappers around Postgres functions (same SQL bodies as cloud).
// The schema.sql file installs identical function definitions locally.
function registerRpcRoutes(app, pool) {
  const rpc = async (fn, payload, userId) => {
    // Set an app-level GUC so functions using current_user_id() get the caller.
    const client = await pool.connect();
    try {
      await client.query('SET LOCAL app.user_id = $1', [userId]);
      const { rows } = await client.query(`SELECT ${fn}($1::jsonb) AS id`, [payload]);
      return { id: rows[0].id };
    } finally { client.release(); }
  };
  app.post('/rpc/complete_sale',           async (req) => rpc('complete_sale',           req.body, req.user.sub));
  app.post('/rpc/complete_purchase',       async (req) => rpc('complete_purchase',       req.body, req.user.sub));
  app.post('/rpc/complete_sale_return',    async (req) => rpc('complete_sale_return',    req.body, req.user.sub));
  app.post('/rpc/complete_purchase_return',async (req) => rpc('complete_purchase_return',req.body, req.user.sub));

  app.post('/rpc/record_payment', async (req) => {
    const { party_type, party_id, amount, method, note } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('SET LOCAL app.user_id = $1', [req.user.sub]);
      const { rows } = await client.query(
        'SELECT record_payment($1,$2,$3,$4,$5) AS id',
        [party_type, party_id, amount, method || 'cash', note || null]
      );
      return { id: rows[0].id };
    } finally { client.release(); }
  });

  app.post('/rpc/has_permission', async (req) => {
    const { perm } = req.body || {};
    const { rows } = await pool.query('SELECT has_permission($1,$2) AS ok', [req.user.sub, perm]);
    return { ok: rows[0].ok };
  });
}

module.exports = { registerRpcRoutes };
