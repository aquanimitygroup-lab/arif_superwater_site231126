// Admin API used by /admin. Every action except login needs a signed-in user.
//   /api/admin?action=<name>
// 'admin' users can do everything. 'production' users (facility staff) can see
// orders, dispatch them, and manage stock; nothing else.
import { db, ensureSchema } from '../lib/db.js';
import { handler, send, query, body, method, str, int, HttpError } from '../lib/http.js';
import { requireUser, verifyPassword, hashPassword, sessionCookie, clearCookie, checkLoginRate } from '../lib/auth.js';
import { CMS_GROUPS } from '../lib/cms-schema.js';
import { DEFAULTS, overrides, cleanValue } from '../lib/content.js';
import { levels, addProduction, stocktake, adjust } from '../lib/inventory.js';
import { staffAction, expireUnpaid } from '../lib/orders.js';
import { GATEWAYS } from '../lib/payments/index.js';

const BOTH = ['admin', 'production'];

export default handler(async (req, res) => {
  // Setup check for the sign-in page. Reports only whether settings exist, never their values.
  if (String(query(req).action || '') === 'status') return send(res, 200, await setupStatus());
  await ensureSchema();
  const sql = db();
  const action = String(query(req).action || '');

  // ---------- sign in / out ----------
  if (action === 'login') {
    method(req, 'POST');
    const recordFailure = await checkLoginRate(req);
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    const [user] = await sql`select * from users where email = ${email} and active`;
    if (!user || !verifyPassword(String(b.password || ''), user.password_hash)) {
      await recordFailure();
      throw new HttpError(401, 'That email and password do not match an account.');
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(user, req) });
  }
  if (action === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });

  const user = await requireUser(req, BOTH);
  const isAdmin = user.role === 'admin';
  const adminOnly = () => { if (!isAdmin) throw new HttpError(403, 'Only administrators can do this.'); };
  const actor = user.email;

  switch (action) {
    case 'me': {
      const [{ n }] = await sql`select count(*)::int as n from users`;
      return send(res, 200, { user, users: n });
    }

    // ---------- overview ----------
    case 'dashboard': {
      await expireUnpaid(sql);
      const [counts] = await sql`
        select
          count(*) filter (where created_at > now() - interval '1 day')::int as orders_24h,
          count(*) filter (where status = 'pending')::int as to_confirm,
          count(*) filter (where status = 'confirmed')::int as to_dispatch,
          coalesce(sum(total) filter (where payment_status = 'paid' and created_at > now() - interval '30 days'), 0)::int as revenue_30d,
          count(*) filter (where payment_status = 'paid' and created_at > now() - interval '30 days')::int as paid_30d
        from orders`;
      const recent = await sql`select id, code, customer_name, city, total, status, payment_status, payment_method, created_at from orders order by created_at desc limit 8`;
      return send(res, 200, { counts, stock: await levels(sql), recent, gateways: gatewayStatus() });
    }

    // ---------- orders ----------
    case 'orders': {
      const q = query(req);
      const status = String(q.status || '');
      const search = String(q.q || '').trim();
      const like = `%${search}%`;
      const rows = await sql`
        select id, code, customer_name, phone, city, total, status, payment_status, payment_method, created_at
        from orders
        where (${status} = '' or status = ${status})
          and (${search} = '' or code ilike ${like} or customer_name ilike ${like} or phone ilike ${like})
        order by created_at desc limit 200`;
      return send(res, 200, { orders: rows });
    }
    case 'order': {
      const id = int(query(req).id, { name: 'Order', min: 1 });
      const [o] = await sql`select * from orders where id = ${id}`;
      if (!o) throw new HttpError(404, 'Order not found.');
      delete o.public_token;
      const events = isAdmin ? await sql`select provider, kind, ok, payload, created_at from payment_events where order_code = ${o.code} order by created_at` : [];
      return send(res, 200, { order: o, events });
    }
    case 'order-action': {
      method(req, 'POST');
      const b = await body(req);
      const act = String(b.action || '');
      if (!isAdmin && act !== 'dispatch') throw new HttpError(403, 'Production accounts can only dispatch orders.');
      const o = await staffAction(sql, int(b.id, { name: 'Order', min: 1 }), act, actor);
      delete o.public_token;
      return send(res, 200, { order: o });
    }

    // ---------- inventory ----------
    case 'stock': {
      const moves = await sql`select * from stock_movements order by created_at desc limit 100`;
      return send(res, 200, { stock: await levels(sql), movements: moves });
    }
    case 'production': {
      method(req, 'POST');
      const b = await body(req);
      await addProduction(sql, { size_ml: Number(b.size_ml), quantity: Number(b.quantity), batch: str(b.batch, { name: 'Batch', max: 60 }), note: str(b.note, { name: 'Note', max: 300 }), actor });
      return send(res, 200, { stock: await levels(sql) });
    }
    case 'stocktake': {
      method(req, 'POST');
      const b = await body(req);
      const r = await stocktake(sql, { size_ml: Number(b.size_ml), counted: Number(b.counted), note: str(b.note, { name: 'Note', max: 300 }), actor });
      return send(res, 200, { ...r, stock: await levels(sql) });
    }
    case 'adjust': {
      method(req, 'POST');
      const b = await body(req);
      await adjust(sql, { size_ml: Number(b.size_ml), change: Number(b.change), note: str(b.note, { name: 'Reason', max: 300 }), actor });
      return send(res, 200, { stock: await levels(sql) });
    }
    case 'threshold': {
      method(req, 'POST');
      const b = await body(req);
      const size = Number(b.size_ml);
      const t = int(b.low_threshold, { name: 'Low-stock alert level', min: 0, max: 10_000_000 });
      await sql`update stock set low_threshold = ${t} where size_ml = ${size}`;
      return send(res, 200, { stock: await levels(sql) });
    }

    // ---------- content ----------
    case 'content': {
      adminOnly();
      const rows = await sql`select key, updated_at, updated_by from content`;
      return send(res, 200, { groups: CMS_GROUPS, defaults: DEFAULTS, values: await overrides(sql), meta: Object.fromEntries(rows.map((r) => [r.key, r])) });
    }
    case 'content-save': {
      adminOnly();
      method(req, 'POST');
      const { values = {}, reset = [] } = await body(req);
      await sql.begin(async (tx) => {
        for (const [key, raw] of Object.entries(values)) {
          const value = cleanValue(key, raw);
          if (JSON.stringify(value) === JSON.stringify(DEFAULTS[key])) {
            await tx`delete from content where key = ${key}`; // same as the original: no override needed
          } else {
            await tx`insert into content (key, value, updated_by) values (${key}, ${tx.json(value)}, ${actor})
                     on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
          }
        }
        for (const key of reset) await tx`delete from content where key = ${String(key)}`;
      });
      return send(res, 200, { values: await overrides(sql) });
    }

    // ---------- products ----------
    case 'products': {
      adminOnly();
      return send(res, 200, { products: await sql`select * from products order by sort` });
    }
    case 'product-save': {
      adminOnly();
      method(req, 'POST');
      const b = await body(req);
      const sku = String(b.sku || '');
      const fields = {
        name: str(b.name, { name: 'Name', required: true, max: 80 }),
        price: int(b.price, { name: 'Price', min: 0, max: 1_000_000 }),
        was: int(b.was, { name: 'Regular price', min: 0, max: 1_000_000 }),
        active: Boolean(b.active),
      };
      const [p] = await sql`update products set ${sql(fields)} where sku = ${sku} returning *`;
      if (!p) throw new HttpError(404, 'Product not found.');
      return send(res, 200, { product: p });
    }

    // ---------- people ----------
    case 'users': {
      adminOnly();
      return send(res, 200, { users: await sql`select id, email, name, role, active, created_at from users order by id` });
    }
    case 'user-save': {
      adminOnly();
      method(req, 'POST');
      const b = await body(req);
      const email = str(b.email, { name: 'Email', required: true, max: 120 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      const role = b.role === 'admin' ? 'admin' : 'production';
      const name = str(b.name, { name: 'Name', max: 80 });
      const active = b.active !== false;
      const password = String(b.password || '');
      if (password && password.length < 10) throw new HttpError(400, 'Passwords need at least 10 characters.');
      if (b.id) {
        const id = int(b.id, { name: 'User', min: 1 });
        if (id === user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot remove your own administrator access.');
        await sql`update users set email = ${email}, name = ${name}, role = ${role}, active = ${active} where id = ${id}`;
        if (password) await sql`update users set password_hash = ${hashPassword(password)} where id = ${id}`;
      } else {
        if (!password) throw new HttpError(400, 'Set a password for the new account (at least 10 characters).');
        try {
          await sql`insert into users (email, name, role, password_hash, active) values (${email}, ${name}, ${role}, ${hashPassword(password)}, ${active})`;
        } catch (e) {
          if (e.code === '23505') throw new HttpError(409, 'An account with that email already exists.');
          throw e;
        }
      }
      return send(res, 200, { users: await sql`select id, email, name, role, active, created_at from users order by id` });
    }
    case 'password': {
      method(req, 'POST');
      const b = await body(req);
      const [u] = await sql`select password_hash from users where id = ${user.id}`;
      if (!verifyPassword(String(b.current || ''), u.password_hash)) throw new HttpError(400, 'Your current password is not correct.');
      const next = String(b.next || '');
      if (next.length < 10) throw new HttpError(400, 'Your new password needs at least 10 characters.');
      const hash = hashPassword(next);
      await sql`update users set password_hash = ${hash} where id = ${user.id}`;
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie({ ...user, password_hash: hash }, req) });
    }

    // ---------- payments ----------
    case 'gateways': {
      adminOnly();
      return send(res, 200, { gateways: gatewayStatus() });
    }
  }
  throw new HttpError(404, 'Unknown request.');
});

function gatewayStatus() {
  const keys = {
    sslcommerz: ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_LIVE (optional)'],
    bkash: ['BKASH_USERNAME', 'BKASH_PASSWORD', 'BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_BASE_URL (live only)'],
  };
  return GATEWAYS.map((g) => ({
    id: g.id, label: g.label, configured: g.configured(),
    live: g.id === 'sslcommerz' ? process.env.SSLCOMMERZ_LIVE === 'true' : g.id === 'bkash' ? Boolean(process.env.BKASH_BASE_URL) : false,
    env: keys[g.id] || [],
  }));
}

async function setupStatus() {
  const env = (k) => (process.env[k] || '').trim();
  const dbUrl = env('DATABASE_URL') || env('POSTGRES_URL');
  const email = env('ADMIN_EMAIL');
  const password = process.env.ADMIN_PASSWORD || '';
  const out = {
    database: { ok: false, message: '' },
    session_secret: { ok: env('SESSION_SECRET').length >= 32, message: env('SESSION_SECRET') ? (env('SESSION_SECRET').length >= 32 ? '' : 'SESSION_SECRET is shorter than 32 characters.') : 'SESSION_SECRET is not set.' },
    admin: { ok: false, message: '' },
  };
  if (!dbUrl) out.database.message = 'DATABASE_URL is not set. Add a Postgres database under Storage in your Vercel project.';
  else {
    try {
      await ensureSchema();
      out.database.ok = true;
      const [{ n }] = await db()`select count(*)::int as n from users where active`;
      if (n > 0) out.admin.ok = true;
      else if (!email) out.admin.message = 'No admin account yet, and ADMIN_EMAIL is not set.';
      else if (password.length < 10) out.admin.message = password ? 'ADMIN_PASSWORD must have at least 10 characters.' : 'No admin account yet, and ADMIN_PASSWORD is not set.';
      else out.admin.message = 'Settings found but no account yet. Redeploy, then reload this page.';
    } catch (e) {
      out.database.message = `Could not connect to the database: ${String(e.message || e).slice(0, 160)}`;
    }
  }
  if (!out.admin.ok && !out.admin.message) out.admin.message = 'Waiting for the database.';
  out.ready = out.database.ok && out.session_secret.ok && out.admin.ok;
  return out;
}
