// Builds the app's database schema inside the local Postgres, once.
//
// Order: 00_* base (Supabase stand-ins) → every supabase/migrations file
// (pg_cron / pg_net CREATE EXTENSION stripped — not shipped offline) →
// 1*_live_drift_* (objects that exist on live but not in migrations) → retry
// the migrations that failed the first pass (they depend on drift objects) →
// drift again, so the live definitions win. A schema-version marker records
// completion; a later app version with new migrations re-runs only those.
'use strict';

const fs = require('fs');
const path = require('path');

// Migrations whose effect the live-drift files replace outright (they fail
// against the live definition by design): record them as applied.
const SUPERSEDED = new Set([
  '20260820191030_bfcc237d-377d-4627-aaaf-8935ef666503.sql', // get_cash_flow_account_totals → live version in drift
]);

const prep = (sql) => sql.replace(/create\s+extension\s+if\s+not\s+exists\s+(pg_cron|pg_net)[^;]*;/gi, '');

async function runFile(pool, sql) {
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO public, extensions');
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('COMMIT');
    return null;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return e;
  } finally {
    c.release();
  }
}

async function ensureSchema(pool, { sqlDir, migrationsDir, log = () => {} }) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS tillix_offline');
  await pool.query('CREATE TABLE IF NOT EXISTS tillix_offline.applied (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM tillix_offline.applied')).rows.map((r) => r.name));
  const mark = (name) => pool.query('INSERT INTO tillix_offline.applied (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);

  const sqlFiles = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
  const base = sqlFiles.filter((f) => f.startsWith('0'));
  const drift = sqlFiles.filter((f) => /^1\d_/.test(f));
  const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const pending = migrations.filter((f) => !done.has('mig:' + f));
  if (!pending.length && done.has('base')) return { applied: 0, failed: [] };

  const t0 = Date.now();
  for (const f of base) {
    const e = await runFile(pool, fs.readFileSync(path.join(sqlDir, f), 'utf8'));
    if (e) throw new Error(`base ${f}: ${e.message}`);
  }
  await mark('base');

  const firstFail = [];
  for (const f of pending) {
    const e = await runFile(pool, prep(fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
    if (e) firstFail.push(f); else await mark('mig:' + f);
  }
  const driftOnce = async () => {
    for (const f of drift) {
      const e = await runFile(pool, fs.readFileSync(path.join(sqlDir, f), 'utf8'));
      if (e) log(`drift ${f}: ${e.message}`);
    }
  };
  await driftOnce();
  const failed = [];
  for (const f of firstFail) {
    const e = await runFile(pool, prep(fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
    if (e && !SUPERSEDED.has(f)) failed.push(`${f}: ${e.message}`); else await mark('mig:' + f);
  }
  await driftOnce();
  // Same grants Supabase applies to the API roles.
  await pool.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await pool.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role');
  await pool.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role');
  await pool.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role');
  log(`schema: ${pending.length} migrations in ${Math.round((Date.now() - t0) / 1000)}s, ${failed.length} not applied`);
  return { applied: pending.length - failed.length, failed };
}

module.exports = { ensureSchema };
