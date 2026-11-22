// Public endpoints used by the website.
//   GET  /api/site?action=content            text, prices, stock, checkout options
//   POST /api/site?action=order              place an order
//   GET  /api/site?action=order&code=&token= a customer's own order
import { db, ensureSchema } from '../lib/db.js';
import { handler, send, query, body, method, siteUrl, HttpError } from '../lib/http.js';
import { overrides, allContent } from '../lib/content.js';
import { levels } from '../lib/inventory.js';
import { createOrder, checkoutOptions, expireUnpaid, publicOrder } from '../lib/orders.js';

export default handler(async (req, res) => {
  await ensureSchema();
  const sql = db();
  const q = query(req);

  if (q.action === 'content') {
    method(req, 'GET');
    await expireUnpaid(sql);
    const [changed, content, products, stock] = await Promise.all([
      overrides(sql), allContent(sql),
      sql`select sku, name, size_ml, bottles, price, was, active from products order by sort`,
      levels(sql),
    ]);
    const available = Object.fromEntries(stock.map((s) => [s.size_ml, Math.max(s.available, 0)]));
    return send(res, 200, {
      content: changed,
      products,
      available,
      checkout: await checkoutOptions(sql, content),
    }, { 'Cache-Control': 'no-cache', 'CDN-Cache-Control': 'max-age=10' }); // browsers always ask; Vercel's edge may reuse for 10 s
  }

  if (q.action === 'order' && req.method === 'POST') {
    const input = await body(req);
    const base = siteUrl(req);
    const { order, redirectUrl } = await createOrder(sql, input, {
      returnUrlFor: (provider, action, code) => `${base}/api/payment?provider=${provider}&action=${action}&order=${encodeURIComponent(code)}`,
    });
    const content = await allContent(sql);
    return send(res, 201, {
      code: order.code,
      token: order.public_token,
      total: order.total,
      redirectUrl: redirectUrl || null,
      message: redirectUrl ? null : content['order.thanks'],
    });
  }

  if (q.action === 'order' && req.method === 'GET') {
    const [o] = await sql`select * from orders where code = ${String(q.code || '')}`;
    if (!o || o.public_token !== String(q.token || '')) throw new HttpError(404, 'Order not found. Check the link in your confirmation.');
    return send(res, 200, publicOrder(o));
  }

  throw new HttpError(404, 'Unknown request.');
});
