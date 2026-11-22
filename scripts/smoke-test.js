// End-to-end check against a running copy of the site (local or a Vercel preview).
//   BASE=http://localhost:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… FACILITY_API_KEY=… npm test
// WARNING: it records production and places and cancels test orders. Use a test database.
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const BASE = process.env.BASE || 'http://localhost:3000';
let cookie = '';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function call(path, { method = 'GET', json, headers = {}, admin = false } = {}) {
  const r = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { 'X-SW-Admin': '1', Cookie: cookie } : {}), ...headers },
    body: json ? JSON.stringify(json) : undefined,
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const fac = { Authorization: `Bearer ${process.env.FACILITY_API_KEY}` };
const customer = { name: 'Test Customer', phone: '01712345678', address: 'House 1, Road 2, Dhanmondi', city: 'Dhaka', payment_method: 'cod' };

// Facility API
ok((await call('/api/facility')).status === 401, 'facility API rejects requests without the key');
let r = await call('/api/facility', { headers: fac });
ok(r.status === 200 && Array.isArray(r.data.stock), 'facility API returns stock with the key');
const start500 = r.data.stock.find((s) => s.size_ml === 500);
r = await call('/api/facility?action=production', { method: 'POST', headers: fac, json: { size_ml: 500, quantity: 50, batch: 'TEST-1' } });
const after = r.data.stock.find((s) => s.size_ml === 500);
ok(r.status === 200 && after.on_hand === start500.on_hand + 50, 'production adds 50 bottles of 500 mL');

// Public content
r = await call('/api/site?action=content');
ok(r.status === 200 && r.data.products.length === 6 && r.data.available['500'] >= 50, 'site content lists products and stock');
ok(r.data.checkout.methods.some((m) => m.id === 'cod'), 'cash on delivery is offered');

// Orders and stock
r = await call('/api/site?action=order', { method: 'POST', json: { ...customer, items: [{ sku: 'single-500', qty: 2, price: 1 }] } });
ok(r.status === 201 && r.data.total >= 60 && r.data.code, `COD order placed at server prices (total Tk ${r.data.total})`);
const order1 = r.data;
r = await call(`/api/site?action=order&code=${order1.code}&token=${order1.token}`);
ok(r.status === 200 && r.data.status === 'pending', 'customer can see their own order');
ok((await call(`/api/site?action=order&code=${order1.code}&token=wrong`)).status === 404, 'order page needs the private token');
r = await call('/api/site?action=content');
const avail = r.data.available['500'];
r = await call('/api/site?action=order', { method: 'POST', json: { ...customer, items: [{ sku: 'single-500', qty: Math.min(avail + 1, 50) }] } });
ok(avail + 1 > 50 ? true : r.status === 409, 'ordering more than is in stock is refused');
r = await call('/api/site?action=order', { method: 'POST', json: { ...customer, phone: '12345', items: [{ sku: 'single-500', qty: 1 }] } });
ok(r.status === 400, 'invalid phone number is refused');

// Admin
ok((await call('/api/admin?action=dashboard', { admin: true })).status === 401, 'admin needs sign-in');
r = await call('/api/admin?action=login', { method: 'POST', json: { email: process.env.ADMIN_EMAIL, password: 'wrong-password' } });
ok(r.status === 401, 'wrong password is refused');
r = await call('/api/admin?action=login', { method: 'POST', json: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
ok(r.status === 200 && cookie, 'admin signs in');
r = await call('/api/admin?action=dashboard', { admin: true });
ok(r.status === 200 && r.data.counts.to_confirm >= 1, 'dashboard shows orders waiting');
r = await call('/api/admin?action=orders', { admin: true });
const o1 = r.data.orders.find((o) => o.code === order1.code);
let stock = (await call('/api/admin?action=stock', { admin: true })).data.stock.find((s) => s.size_ml === 500);
r = await call('/api/admin?action=order-action', { method: 'POST', admin: true, json: { id: o1.id, action: 'dispatch' } });
let stock2 = (await call('/api/admin?action=stock', { admin: true })).data.stock.find((s) => s.size_ml === 500);
ok(r.status === 200 && stock2.on_hand === stock.on_hand - 2 && stock2.reserved === stock.reserved - 2, 'dispatch takes 2 bottles out of the facility');
r = await call('/api/admin?action=order-action', { method: 'POST', admin: true, json: { id: o1.id, action: 'deliver' } });
ok(r.data.order?.payment_status === 'paid' && r.data.order.status === 'delivered', 'delivering a COD order marks it paid');

r = await call('/api/site?action=order', { method: 'POST', json: { ...customer, items: [{ sku: 'day-500', qty: 1 }] } });
const o2 = (await call('/api/admin?action=orders', { admin: true })).data.orders.find((o) => o.code === r.data.code);
stock = stock2;
await call('/api/admin?action=order-action', { method: 'POST', admin: true, json: { id: o2.id, action: 'cancel' } });
stock2 = (await call('/api/admin?action=stock', { admin: true })).data.stock.find((s) => s.size_ml === 500);
ok(stock2.reserved === stock.reserved && stock2.on_hand === stock.on_hand, 'cancelling an order returns its reserved bottles');

// Content editing
r = await call('/api/admin?action=content-save', { method: 'POST', admin: true, json: { values: { 'hero.eyebrow': 'Test label' } } });
ok(r.status === 200 && r.data.values['hero.eyebrow'] === 'Test label', 'content change saved');
r = await call('/api/site?action=content');
ok(r.data.content['hero.eyebrow'] === 'Test label', 'website receives the changed text');
await call('/api/admin?action=content-save', { method: 'POST', admin: true, json: { reset: ['hero.eyebrow'] } });
ok((await call('/api/site?action=content')).data.content['hero.eyebrow'] === undefined, 'content reset to the original');
r = await call('/api/admin?action=content-save', { method: 'POST', admin: true, json: { values: { 'not.a.field': 'x' } } });
ok(r.status === 400, 'unknown content fields are refused');

// Request forgery protection
r = await call('/api/admin?action=adjust', { method: 'POST', json: { size_ml: 500, change: -1, note: 'x' }, headers: { Cookie: cookie } });
ok(r.status === 403, 'changes without the admin header are blocked');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
