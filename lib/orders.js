import { randomBytes, randomInt } from 'node:crypto';
import { HttpError, str } from './http.js';
import { reserve, release, dispatch } from './inventory.js';
import { allContent } from './content.js';
import { COD, gateway, configuredGateways } from './payments/index.js';

const UNPAID_ONLINE_EXPIRY = '2 hours';

/** Payment choices offered at checkout right now. */
export async function checkoutOptions(sql, content) {
  const c = content || (await allContent(sql));
  const methods = [];
  if (c['order.cod_enabled']) methods.push({ id: COD.id, label: COD.label, needsEmail: false });
  if (c['order.online_enabled']) for (const g of configuredGateways()) methods.push({ id: g.id, label: g.label, needsEmail: g.needsEmail });
  const areas = String(c['order.areas'] || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return { methods, delivery_fee: c['order.delivery_fee'], free_over: c['order.free_over'], areas };
}

export function deliveryFee(subtotal, options) {
  if (options.free_over > 0 && subtotal >= options.free_over) return 0;
  return options.delivery_fee || 0;
}

function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+?88/, '');
  if (!/^01[3-9]\d{8}$/.test(digits)) throw new HttpError(400, 'Enter a valid Bangladeshi mobile number, for example 01712345678.');
  return digits;
}

function newCode() {
  const d = new Date(Date.now() + 6 * 3600e3); // Bangladesh time for the date part
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  return `SW-${ymd}-${randomInt(1000, 10000)}`;
}

/**
 * Creates an order from the website. Prices always come from the database,
 * never from the browser. Stock is reserved in the same transaction.
 */
export async function createOrder(sql, input, { returnUrlFor }) {
  const options = await checkoutOptions(sql);
  const method = String(input.payment_method || '');
  const chosen = options.methods.find((m) => m.id === method);
  if (!chosen) throw new HttpError(400, 'Choose a payment method.');

  const customer = {
    customer_name: str(input.name, { name: 'Your name', required: true, max: 80, min: 2 }),
    phone: normalisePhone(input.phone),
    email: str(input.email, { name: 'Email', max: 120 }) || null,
    address: str(input.address, { name: 'Delivery address', required: true, max: 300, min: 5 }),
    city: str(input.city, { name: 'Area or city', required: true, max: 60 }),
    note: str(input.note, { name: 'Note', max: 300 }) || null,
  };
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new HttpError(400, 'Enter a valid email address, or leave it empty.');
  if (chosen.needsEmail && !customer.email) throw new HttpError(400, `${chosen.label} needs your email address for the receipt.`);
  if (options.areas.length && !options.areas.includes(customer.city)) throw new HttpError(400, 'Choose a delivery area from the list.');

  if (!Array.isArray(input.items) || input.items.length === 0) throw new HttpError(400, 'Your cart is empty.');
  if (input.items.length > 20) throw new HttpError(400, 'Too many different items in one order.');
  const wanted = new Map();
  for (const it of input.items) {
    const qty = Number(it?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, 'Each item quantity must be between 1 and 50.');
    wanted.set(String(it.sku), (wanted.get(String(it.sku)) || 0) + qty);
  }
  const products = await sql`select sku, name, size_ml, bottles, price, active from products where sku in ${sql([...wanted.keys()])}`;
  const items = [...wanted].map(([sku, qty]) => {
    const p = products.find((x) => x.sku === sku);
    if (!p || !p.active) throw new HttpError(400, 'One of the items in your cart is no longer available. Please refresh the page.');
    return { sku, name: p.name, qty, price: p.price, size_ml: p.size_ml, bottles: p.bottles };
  });
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);
  const delivery_fee = deliveryFee(subtotal, options);
  const total = subtotal + delivery_fee;

  let order;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await sql.begin(async (tx) => {
        const code = newCode();
        const [row] = await tx`
          insert into orders ${tx({
            code, public_token: randomBytes(16).toString('hex'), ...customer,
            items: tx.json(items), subtotal, delivery_fee, total,
            payment_method: method, payment_status: method === 'cod' ? 'unpaid' : 'pending',
          })}
          returning *`;
        await reserve(tx, items, code);
        return row;
      });
    } catch (e) {
      if (e.code === '23505') continue; // order code already used; try another
      throw e;
    }
  }
  if (!order) throw new HttpError(500, 'Could not create the order. Please try again.');

  if (method === 'cod') return { order };

  // Online payment: start it with the gateway.
  const g = gateway(method);
  try {
    const started = await g.start({ order, sql, returnUrl: (action) => returnUrlFor(g.id, action, order.code) });
    await sql`update orders set provider_ref = ${started.providerRef || null}, updated_at = now() where id = ${order.id}`;
    await logPayment(sql, order.code, g.id, 'init', true, started.raw);
    return { order, redirectUrl: started.redirectUrl };
  } catch (e) {
    console.error(e);
    await logPayment(sql, order.code, g.id, 'init', false, { error: String(e.message || e) });
    await sql.begin(async (tx) => {
      const [o] = await tx`select * from orders where id = ${order.id} for update`;
      await release(tx, o, 'website');
      await tx`update orders set status = 'cancelled', payment_status = 'failed', updated_at = now() where id = ${o.id}`;
    });
    throw new HttpError(502, `${g.label} could not start the payment. Please try again, or choose another payment method.`);
  }
}

export async function logPayment(sql, order_code, provider, kind, ok, payload) {
  await sql`insert into payment_events (order_code, provider, kind, ok, payload)
            values (${order_code || null}, ${provider}, ${kind}, ${ok}, ${sql.json(payload || {})})`;
}

/** Applies a gateway's verified result to the order. Safe to call more than once. */
export async function applyPayment(sql, { orderCode, outcome, amount, providerRef, provider }) {
  if (!orderCode || outcome === 'pending') return null;
  return sql.begin(async (tx) => {
    const [o] = await tx`select * from orders where code = ${orderCode} for update`;
    if (!o || o.payment_method !== provider) return null;
    if (outcome === 'paid') {
      if (o.payment_status === 'paid') return o;
      if (amount !== undefined && Math.abs(amount - o.total) > 0.5) {
        // Wrong amount: never accept it. Cancel, return the stock, and leave a note so staff can refund.
        const warning = `Gateway reported Tk ${amount}, but the order total is Tk ${o.total}. Payment not accepted; refund the customer through the gateway.`;
        await release(tx, o, provider);
        const [u] = await tx`update orders set payment_status = 'failed', status = 'cancelled',
                               note = concat_ws(' | ', note, ${warning}::text), updated_at = now()
                             where id = ${o.id} returning *`;
        return u;
      }
      const [u] = await tx`update orders set payment_status = 'paid',
                             status = case when status = 'pending' then 'confirmed' else status end,
                             provider_ref = coalesce(${providerRef || null}, provider_ref), updated_at = now()
                           where id = ${o.id} returning *`;
      return u;
    }
    // failed or cancelled
    if (o.payment_status === 'paid' || o.status !== 'pending') return o;
    await release(tx, o, provider);
    const [u] = await tx`update orders set payment_status = 'failed', status = 'cancelled', updated_at = now() where id = ${o.id} returning *`;
    return u;
  });
}

/** Online orders never paid within the time limit are cancelled and their stock returned. */
export async function expireUnpaid(sql) {
  const stale = await sql`select id from orders where payment_method <> 'cod' and status = 'pending'
                          and payment_status in ('unpaid', 'pending') and created_at < now() - ${UNPAID_ONLINE_EXPIRY}::interval`;
  for (const { id } of stale) {
    await sql.begin(async (tx) => {
      const [o] = await tx`select * from orders where id = ${id} for update`;
      if (o.status !== 'pending' || o.payment_status === 'paid') return;
      await release(tx, o, 'system');
      await tx`update orders set status = 'cancelled', payment_status = 'failed', updated_at = now() where id = ${id}`;
    });
  }
  return stale.length;
}

/** Status changes made by staff in the admin. */
export async function staffAction(sql, orderId, action, actor) {
  return sql.begin(async (tx) => {
    const [o] = await tx`select * from orders where id = ${orderId} for update`;
    if (!o) throw new HttpError(404, 'Order not found.');
    const set = async (fields) => (await tx`update orders set ${tx(fields)}, updated_at = now() where id = ${o.id} returning *`)[0];
    switch (action) {
      case 'confirm':
        if (o.status !== 'pending') throw new HttpError(409, 'Only new orders can be confirmed.');
        return set({ status: 'confirmed' });
      case 'dispatch':
        if (!['pending', 'confirmed'].includes(o.status)) throw new HttpError(409, 'Only new or confirmed orders can be dispatched.');
        if (o.payment_method !== 'cod' && o.payment_status !== 'paid') throw new HttpError(409, 'This online order has not been paid yet.');
        await dispatch(tx, o, actor);
        return set({ status: 'dispatched' });
      case 'deliver':
        if (o.status !== 'dispatched') throw new HttpError(409, 'Only dispatched orders can be marked delivered.');
        return set(o.payment_method === 'cod' ? { status: 'delivered', payment_status: 'paid' } : { status: 'delivered' });
      case 'cancel':
        if (!['pending', 'confirmed'].includes(o.status)) throw new HttpError(409, 'Orders that have left the facility cannot be cancelled here.');
        await release(tx, o, actor);
        return set({ status: 'cancelled' });
      case 'mark_paid':
        return set({ payment_status: 'paid' });
      case 'mark_refunded':
        if (o.payment_status !== 'paid') throw new HttpError(409, 'Only paid orders can be marked refunded.');
        return set({ payment_status: 'refunded' });
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  });
}

/** What the customer may see about their own order. */
export function publicOrder(o) {
  return {
    code: o.code, status: o.status, payment_status: o.payment_status, payment_method: o.payment_method,
    items: o.items.map(({ name, qty, price }) => ({ name, qty, price })),
    subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total,
    customer_name: o.customer_name, city: o.city, created_at: o.created_at,
  };
}
