// Minimal PostgREST-shaped table endpoints. Phase 2 will expand operators.
// Whitelist tables to prevent arbitrary SQL exposure.
const TABLES = new Set([
  'products','product_barcodes','customers','suppliers','expense_persons','expenses',
  'sales','sale_items','sale_returns','sale_return_items',
  'purchases','purchase_items','purchase_returns','purchase_return_items',
  'party_payments','store_settings','app_users','user_permissions',
]);

function parseFilters(query) {
  const filters = [];
  const params = [];
  let order = null;
  let limit = null;
  let select = '*';
  for (const [k, v] of Object.entries(query)) {
    if (k === 'select') { select = v; continue; }
    if (k === 'order')  { order  = v; continue; }
    if (k === 'limit')  { limit  = parseInt(v, 10); continue; }
    const m = /^([a-z_]+)\.(.+)$/.exec(String(v));
    if (!m) continue;
    const [, op, val] = m;
    params.push(val);
    const p = `$${params.length}`;
    switch (op) {
      case 'eq':  filters.push(`${k} = ${p}`); break;
      case 'neq': filters.push(`${k} <> ${p}`); break;
      case 'gt':  filters.push(`${k} > ${p}`); break;
      case 'gte': filters.push(`${k} >= ${p}`); break;
      case 'lt':  filters.push(`${k} < ${p}`); break;
      case 'lte': filters.push(`${k} <= ${p}`); break;
      case 'like':filters.push(`${k} LIKE ${p}`); break;
      case 'ilike':filters.push(`${k} ILIKE ${p}`); break;
      case 'is':
        params.pop();
        filters.push(`${k} IS ${val === 'null' ? 'NULL' : val.toUpperCase()}`);
        break;
    }
  }
  return { select, filters, params, order, limit };
}

function registerTableRoutes(app, pool) {
  app.get('/table/:name', async (req, reply) => {
    const { name } = req.params;
    if (!TABLES.has(name)) return reply.code(404).send({ error: 'Unknown table' });
    const { select, filters, params, order, limit } = parseFilters(req.query);
    let sql = `SELECT ${select} FROM ${name}`;
    if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
    if (order) {
      const [col, dir='asc'] = order.split('.');
      sql += ` ORDER BY ${col} ${dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    }
    if (limit) sql += ` LIMIT ${limit}`;
    const { rows } = await pool.query(sql, params);
    return rows;
  });

  app.post('/table/:name', async (req, reply) => {
    const { name } = req.params;
    if (!TABLES.has(name)) return reply.code(404).send({ error: 'Unknown table' });
    const body = Array.isArray(req.body) ? req.body : [req.body];
    if (!body.length) return [];
    const cols = Object.keys(body[0]);
    const values = [];
    const rows = body.map((r, i) => {
      const marks = cols.map((c, j) => {
        values.push(r[c]);
        return `$${i * cols.length + j + 1}`;
      });
      return `(${marks.join(',')})`;
    });
    const sql = `INSERT INTO ${name} (${cols.join(',')}) VALUES ${rows.join(',')} RETURNING *`;
    const res = await pool.query(sql, values);
    return res.rows;
  });

  app.patch('/table/:name', async (req, reply) => {
    const { name } = req.params;
    if (!TABLES.has(name)) return reply.code(404).send({ error: 'Unknown table' });
    const { filters, params } = parseFilters(req.query);
    if (!filters.length) return reply.code(400).send({ error: 'Filter required for update' });
    const patch = req.body || {};
    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => { params.push(patch[c]); return `${c} = $${params.length}`; });
    const sql = `UPDATE ${name} SET ${sets.join(', ')} WHERE ${filters.join(' AND ')} RETURNING *`;
    const res = await pool.query(sql, params);
    return res.rows;
  });

  app.delete('/table/:name', async (req, reply) => {
    const { name } = req.params;
    if (!TABLES.has(name)) return reply.code(404).send({ error: 'Unknown table' });
    const { filters, params } = parseFilters(req.query);
    if (!filters.length) return reply.code(400).send({ error: 'Filter required for delete' });
    const sql = `DELETE FROM ${name} WHERE ${filters.join(' AND ')} RETURNING *`;
    const res = await pool.query(sql, params);
    return res.rows;
  });
}

module.exports = { registerTableRoutes };
