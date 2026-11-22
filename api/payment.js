// Where payment gateways send customers back, and their server notifications.
//   /api/payment?provider=<id>&action=<success|fail|cancel|ipn|callback>&order=<code>
import { db, ensureSchema } from '../lib/db.js';
import { handler, send, query, body, redirect, HttpError } from '../lib/http.js';
import { gateway } from '../lib/payments/index.js';
import { applyPayment, logPayment } from '../lib/orders.js';

export default handler(async (req, res) => {
  await ensureSchema();
  const sql = db();
  const q = query(req);
  const g = gateway(String(q.provider || ''));
  if (!g || !g.configured()) throw new HttpError(404, 'Unknown payment provider.');

  const b = req.method === 'POST' ? await body(req) : {};
  let result;
  try {
    result = await g.handle({ action: String(q.action || ''), query: q, body: b, sql });
  } catch (e) {
    console.error(e);
    result = { orderCode: q.order, outcome: 'pending', raw: { error: String(e.message || e) } };
  }
  await logPayment(sql, result.orderCode, g.id, q.action === 'ipn' ? 'ipn' : 'callback', result.outcome === 'paid', { outcome: result.outcome, ...result.raw });
  await applyPayment(sql, { ...result, provider: g.id });

  // Server-to-server notifications just need an acknowledgement.
  if (q.action === 'ipn') return send(res, 200, { received: true });

  // Customers go to their order page, which shows the result.
  const [o] = await sql`select code, public_token from orders where code = ${String(result.orderCode || q.order || '')}`;
  if (!o) return redirect(res, '/?payment=unknown#shop');
  return redirect(res, `/order?code=${encodeURIComponent(o.code)}&token=${o.public_token}`);
});
