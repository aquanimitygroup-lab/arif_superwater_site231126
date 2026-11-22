// API for the production facility's own systems (or a script/spreadsheet tool).
// Every request needs:  Authorization: Bearer <FACILITY_API_KEY>
//
//   GET  /api/facility                       stock levels and orders waiting for dispatch
//   POST /api/facility?action=production     {"size_ml":500,"quantity":2400,"batch":"B-1121","note":"Line 1"}
//   POST /api/facility?action=stocktake      {"size_ml":500,"counted":5120,"note":"Monthly count"}
import { db, ensureSchema } from '../lib/db.js';
import { handler, send, query, body, HttpError } from '../lib/http.js';
import { requireFacilityKey } from '../lib/auth.js';
import { levels, addProduction, stocktake } from '../lib/inventory.js';

export default handler(async (req, res) => {
  requireFacilityKey(req);
  await ensureSchema();
  const sql = db();
  const q = query(req);

  if (req.method === 'GET') {
    const waiting = await sql`select code, created_at, status, payment_status, items from orders
                              where status in ('pending', 'confirmed') and stock_state = 'reserved' order by created_at`;
    return send(res, 200, {
      stock: (await levels(sql)).map(({ size_ml, on_hand, reserved, available, low_threshold }) => ({ size_ml, on_hand, reserved, available, low_threshold })),
      orders_to_dispatch: waiting.map((o) => ({ code: o.code, created_at: o.created_at, status: o.status, payment_status: o.payment_status,
        items: o.items.map(({ sku, qty, size_ml, bottles }) => ({ sku, qty, size_ml, bottles: bottles * qty })) })),
    });
  }

  if (req.method === 'POST') {
    const b = await body(req);
    const actor = 'facility-api';
    if (q.action === 'production') {
      await addProduction(sql, { size_ml: Number(b.size_ml), quantity: Number(b.quantity), batch: b.batch ? String(b.batch).slice(0, 60) : null, note: b.note ? String(b.note).slice(0, 300) : null, actor });
      return send(res, 200, { ok: true, stock: await levels(sql) });
    }
    if (q.action === 'stocktake') {
      const r = await stocktake(sql, { size_ml: Number(b.size_ml), counted: Number(b.counted), note: b.note ? String(b.note).slice(0, 300) : null, actor });
      return send(res, 200, { ok: true, ...r, stock: await levels(sql) });
    }
  }
  throw new HttpError(404, 'Unknown request. See the comments at the top of api/facility.js.');
});
