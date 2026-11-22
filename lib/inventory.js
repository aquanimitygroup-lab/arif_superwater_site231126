import { HttpError } from './http.js';

/**
 * Stock is counted in bottles per size at the production facility.
 *   on_hand   bottles physically at the facility
 *   reserved  bottles promised to website orders not yet dispatched
 *   available on_hand - reserved (what the website can still sell)
 *
 * Order life cycle and what it does to stock:
 *   order placed      reserved += bottles
 *   order cancelled   reserved -= bottles            (if still reserved)
 *   order dispatched  on_hand -= bottles, reserved -= bottles
 * Every change is written to stock_movements.
 */

export const SIZES = [500, 2000];
export const sizeLabel = (ml) => (ml === 2000 ? '2 L' : `${ml} mL`);

/** Bottles needed per size for a list of order items. */
export function bottlesBySize(items) {
  const need = {};
  for (const it of items) need[it.size_ml] = (need[it.size_ml] || 0) + it.bottles * it.qty;
  return need;
}

export async function levels(sql) {
  const rows = await sql`select size_ml, on_hand, reserved, low_threshold, updated_at from stock order by size_ml`;
  return rows.map((r) => ({ ...r, available: r.on_hand - r.reserved, low: r.on_hand - r.reserved <= r.low_threshold }));
}

/** Locks the stock rows, checks there is enough, and reserves. Call inside sql.begin(). */
export async function reserve(tx, items, orderCode) {
  const need = bottlesBySize(items);
  const sizes = Object.keys(need).map(Number);
  const rows = await tx`select size_ml, on_hand, reserved from stock where size_ml in ${tx(sizes)} order by size_ml for update`;
  for (const r of rows) {
    const available = r.on_hand - r.reserved;
    if (available < need[r.size_ml]) {
      throw new HttpError(409, available <= 0
        ? `Sorry, ${sizeLabel(r.size_ml)} bottles are out of stock right now.`
        : `Sorry, we only have ${available} ${sizeLabel(r.size_ml)} bottle${available === 1 ? '' : 's'} left. Please reduce your order.`);
    }
  }
  for (const size of sizes) {
    await tx`update stock set reserved = reserved + ${need[size]}, updated_at = now() where size_ml = ${size}`;
    await tx`insert into stock_movements (size_ml, reserved_change, reason, ref, actor)
             values (${size}, ${need[size]}, 'order_reserved', ${orderCode}, 'website')`;
  }
}

/** Gives reserved bottles back when an order is cancelled before dispatch. */
export async function release(tx, order, actor) {
  if (order.stock_state !== 'reserved') return;
  const need = bottlesBySize(order.items);
  for (const [size, n] of Object.entries(need)) {
    await tx`update stock set reserved = greatest(reserved - ${n}, 0), updated_at = now() where size_ml = ${size}`;
    await tx`insert into stock_movements (size_ml, reserved_change, reason, ref, actor)
             values (${size}, ${-n}, 'order_released', ${order.code}, ${actor})`;
  }
  await tx`update orders set stock_state = 'released', updated_at = now() where id = ${order.id}`;
}

/** Takes bottles out of the facility when an order leaves. */
export async function dispatch(tx, order, actor) {
  if (order.stock_state !== 'reserved') throw new HttpError(409, 'This order no longer holds stock, so it cannot be dispatched. Place a new order instead.');
  const need = bottlesBySize(order.items);
  for (const [size, n] of Object.entries(need)) {
    const [row] = await tx`select on_hand from stock where size_ml = ${size} for update`;
    if (row.on_hand < n) throw new HttpError(409, `The facility only has ${row.on_hand} ${sizeLabel(Number(size))} bottles on hand. Record production or a stock count first.`);
    await tx`update stock set on_hand = on_hand - ${n}, reserved = greatest(reserved - ${n}, 0), updated_at = now() where size_ml = ${size}`;
    await tx`insert into stock_movements (size_ml, on_hand_change, reserved_change, reason, ref, actor)
             values (${size}, ${-n}, ${-n}, 'order_dispatched', ${order.code}, ${actor})`;
  }
  await tx`update orders set stock_state = 'dispatched', updated_at = now() where id = ${order.id}`;
}

/** New bottles produced at the facility. */
export async function addProduction(sql, { size_ml, quantity, batch, note, actor }) {
  checkSize(size_ml);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new HttpError(400, 'Quantity must be a whole number above 0.');
  return sql.begin(async (tx) => {
    await tx`update stock set on_hand = on_hand + ${quantity}, updated_at = now() where size_ml = ${size_ml}`;
    await tx`insert into stock_movements (size_ml, on_hand_change, reason, ref, note, actor)
             values (${size_ml}, ${quantity}, 'production', ${batch || null}, ${note || null}, ${actor})`;
  });
}

/** A physical count at the facility replaces the on-hand number. */
export async function stocktake(sql, { size_ml, counted, note, actor }) {
  checkSize(size_ml);
  if (!Number.isInteger(counted) || counted < 0 || counted > 10_000_000) throw new HttpError(400, 'The counted amount must be a whole number, 0 or more.');
  return sql.begin(async (tx) => {
    const [row] = await tx`select on_hand from stock where size_ml = ${size_ml} for update`;
    const change = counted - row.on_hand;
    await tx`update stock set on_hand = ${counted}, updated_at = now() where size_ml = ${size_ml}`;
    await tx`insert into stock_movements (size_ml, on_hand_change, reason, note, actor)
             values (${size_ml}, ${change}, 'stocktake', ${note || null}, ${actor})`;
    return { previous: row.on_hand, counted, change };
  });
}

/** Breakage, samples, returns and similar: adds or removes bottles. */
export async function adjust(sql, { size_ml, change, note, actor }) {
  checkSize(size_ml);
  if (!Number.isInteger(change) || change === 0) throw new HttpError(400, 'Enter a whole number other than 0 (negative to remove bottles).');
  if (!note) throw new HttpError(400, 'Give a reason for the adjustment.');
  return sql.begin(async (tx) => {
    const [row] = await tx`select on_hand from stock where size_ml = ${size_ml} for update`;
    if (row.on_hand + change < 0) throw new HttpError(400, `That would leave fewer than 0 bottles (there are ${row.on_hand}).`);
    await tx`update stock set on_hand = on_hand + ${change}, updated_at = now() where size_ml = ${size_ml}`;
    await tx`insert into stock_movements (size_ml, on_hand_change, reason, note, actor)
             values (${size_ml}, ${change}, 'adjustment', ${note}, ${actor})`;
  });
}

function checkSize(size_ml) {
  if (!SIZES.includes(size_ml)) throw new HttpError(400, 'Bottle size must be 500 or 2000 (mL).');
}
