// Local stand-in for the Supabase API, for the offline desktop edition.
//
// The app talks to "Supabase" through supabase-js, which calls
//   /rest/v1/*  -> PostgREST (the same server Supabase runs; we run it locally)
//   /auth/v1/*  -> GoTrue (Supabase Auth)
// This gateway serves both on one local port: /rest/v1 is proxied to a local
// PostgREST, and the handful of /auth/v1 endpoints the app uses (sign up,
// password sign-in, refresh, get/update user, sign out) are implemented here
// against auth.users in the local Postgres. Everything else (realtime,
// storage, edge functions) answers "not available offline".
//
// Tokens are HS256 JWTs signed with a per-install secret that PostgREST is
// configured with, so RLS sees the same auth.uid() it would in the cloud.
'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expect = b64url(crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest());
  const a = Buffer.from(expect); const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

/** The anon key baked into the offline build (VITE_SUPABASE_PUBLISHABLE_KEY).
 *  It is public, like Supabase's anon key: requests carrying it are treated
 *  as anonymous — the gateway strips it so PostgREST uses its anon role. That
 *  lets the JWT secret PostgREST verifies user tokens with be random per
 *  install, instead of a constant every copy of the exe would share. */
const OFFLINE_ANON_KEY = signJwt({ role: 'anon', iss: 'tillix-offline', iat: 0, exp: 4102444800 }, 'tillix-offline-public-anon-key');

const ACCESS_TTL = 60 * 60; // 1h, refreshed by supabase-js as usual

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, obj, extraHeaders = {}) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders });
  res.end(body);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, range, range-unit, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'content-range, range-unit, content-location, preference-applied, location',
  };
}

function authError(res, status, code, msg) {
  send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg });
}

function userJson(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    phone: u.phone || '',
    confirmed_at: u.email_confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'], ...(u.raw_app_meta_data || {}) },
    user_metadata: u.raw_user_meta_data || {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { sub: u.id, email: u.email }, created_at: u.created_at, updated_at: u.updated_at }],
    created_at: u.created_at,
    updated_at: u.updated_at,
    is_anonymous: false,
  };
}

function createGateway({ pool, secret, postgrestPort, port = 54330, host = '127.0.0.1', log = () => {} }) {
  const anonKey = OFFLINE_ANON_KEY;

  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const userById = async (id) => (await q('SELECT * FROM auth.users WHERE id = $1 AND deleted_at IS NULL', [id]))[0] || null;

  async function issueSession(user) {
    const now = Math.floor(Date.now() / 1000);
    const sessionId = crypto.randomUUID();
    await q('INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)', [sessionId, user.id]);
    const refresh = b64url(crypto.randomBytes(32));
    await q('INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES ($1, $2, $3)', [refresh, user.id, sessionId]);
    await q('UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1', [user.id]);
    const fresh = await userById(user.id);
    const access = signJwt({
      aud: 'authenticated', exp: now + ACCESS_TTL, iat: now, iss: 'tillix-offline',
      sub: user.id, email: user.email, phone: '', role: 'authenticated',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: fresh.raw_user_meta_data || {}, session_id: sessionId, is_anonymous: false,
    }, secret);
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: userJson(fresh) };
  }

  function bearerUser(req) {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    const p = verifyJwt(tok, secret);
    return p && p.role === 'authenticated' && p.sub ? p : null;
  }

  async function handleAuth(req, res, url) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    const method = req.method;
    let body = {};
    if (method === 'POST' || method === 'PUT') {
      const raw = (await readBody(req)).toString('utf8');
      try { body = raw ? JSON.parse(raw) : {}; } catch { return authError(res, 400, 'bad_json', 'Invalid JSON'); }
    }

    if (path === '/health' || path === '/settings') {
      return send(res, 200, path === '/health' ? { name: 'tillix-offline-auth' } : { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
    }

    if (path === '/signup' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return authError(res, 400, 'validation_failed', 'Email and password are required');
      if (password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters');
      const exists = await q('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
      if (exists.length) return authError(res, 422, 'user_already_exists', 'User already registered');
      // No mail server offline: accounts are confirmed immediately.
      const [u] = await q(
        `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
         VALUES ($1, extensions.crypt($2, extensions.gen_salt('bf')), now(), $3::jsonb, '{"provider":"email","providers":["email"]}'::jsonb)
         RETURNING *`,
        [email, password, JSON.stringify((body.data || body.options?.data) || {})],
      );
      await q("INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, 'email', $2::jsonb)", [u.id, JSON.stringify({ sub: u.id, email })]);
      return send(res, 200, await issueSession(u));
    }

    if (path === '/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const email = String(body.email || '').trim().toLowerCase();
        const rows = await q(
          `SELECT * FROM auth.users WHERE lower(email) = $1 AND deleted_at IS NULL
             AND encrypted_password = extensions.crypt($2, encrypted_password)`,
          [email, String(body.password || '')],
        );
        if (!rows.length) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
        if (rows[0].banned_until && new Date(rows[0].banned_until) > new Date()) return authError(res, 400, 'user_banned', 'User is banned');
        return send(res, 200, await issueSession(rows[0]));
      }
      if (grant === 'refresh_token') {
        const rows = await q('UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE token = $1 AND NOT revoked RETURNING user_id', [String(body.refresh_token || '')]);
        if (!rows.length) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        const u = await userById(rows[0].user_id);
        if (!u) return authError(res, 400, 'user_not_found', 'User not found');
        return send(res, 200, await issueSession(u));
      }
      return authError(res, 400, 'unsupported_grant_type', 'Unsupported grant type');
    }

    if (path === '/user') {
      const claims = bearerUser(req);
      if (!claims) return authError(res, 401, 'bad_jwt', 'Invalid or expired token');
      if (method === 'GET') {
        const u = await userById(claims.sub);
        return u ? send(res, 200, userJson(u)) : authError(res, 404, 'user_not_found', 'User not found');
      }
      if (method === 'PUT') {
        if (body.password) {
          if (String(body.password).length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters');
          await q("UPDATE auth.users SET encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() WHERE id = $1", [claims.sub, String(body.password)]);
        }
        if (body.data && typeof body.data === 'object') {
          // Same as GoTrue: merge, and a null value removes the key.
          await q(
            `UPDATE auth.users SET raw_user_meta_data = jsonb_strip_nulls(COALESCE(raw_user_meta_data, '{}'::jsonb) || $2::jsonb), updated_at = now() WHERE id = $1`,
            [claims.sub, JSON.stringify(body.data)],
          );
        }
        return send(res, 200, userJson(await userById(claims.sub)));
      }
    }

    if (path === '/logout' && method === 'POST') {
      const claims = bearerUser(req);
      if (claims) await q('UPDATE auth.refresh_tokens SET revoked = true WHERE user_id = $1', [claims.sub]);
      return send(res, 204);
    }

    if (path === '/recover' || path === '/resend' || path === '/otp' || path === '/verify') {
      return authError(res, 400, 'offline', 'Email is not available in the offline edition');
    }

    return authError(res, 404, 'not_found', 'Not available in the offline edition');
  }

  function proxyRest(req, res, url) {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.apikey;
    // The bundled anon key (or no token at all) → anonymous: let PostgREST
    // fall back to its anon role. Any other token is passed on for PostgREST
    // to verify against the same secret.
    const auth = headers.authorization || '';
    if (!auth || auth === `Bearer ${anonKey}`) delete headers.authorization;
    const upstream = http.request({
      host: '127.0.0.1', port: postgrestPort, method: req.method,
      path: url.pathname.replace(/^\/rest\/v1/, '') + url.search, headers,
    }, (up) => {
      // PostgREST sends its own CORS headers; two Access-Control-Allow-Origin
      // values make the browser reject the response, so only ours go out.
      const h = { ...up.headers };
      for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-')) delete h[k];
      res.writeHead(up.statusCode || 502, { ...h, ...corsHeaders() });
      up.pipe(res);
    });
    upstream.on('error', (e) => send(res, 502, { message: 'Local database API unavailable: ' + e.message }));
    req.pipe(upstream);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
      if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
      return send(res, 404, { message: 'Not available in the offline edition' });
    } catch (e) {
      log('gateway error', e);
      if (!res.headersSent) send(res, 500, { message: String(e && e.message || e) });
    }
  });
  // Realtime websockets: refuse cleanly (the app backs off and keeps working).
  server.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); });

  return {
    anonKey,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(port)); }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { createGateway, signJwt, verifyJwt, OFFLINE_ANON_KEY };
