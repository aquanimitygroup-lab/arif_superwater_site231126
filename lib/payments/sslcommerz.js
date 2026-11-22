/**
 * SSLCommerz (cards, mobile banking, internet banking) — API v4.
 * https://developer.sslcommerz.com/doc/v4/
 *
 * Environment variables:
 *   SSLCOMMERZ_STORE_ID        your store ID
 *   SSLCOMMERZ_STORE_PASSWORD  your store password (API password)
 *   SSLCOMMERZ_LIVE            "true" for real payments; anything else uses the sandbox
 *
 * Flow: we create a session and send the customer to GatewayPageURL. When they
 * finish, SSLCommerz sends them back (success/fail/cancel) and also calls our
 * IPN address server-to-server. A payment only counts once the validation API
 * confirms it (status VALID or VALIDATED) for the right order and amount.
 */
const env = (k) => (process.env[k] || '').trim();
// SSLCOMMERZ_BASE_URL is only for automated tests; leave it unset.
const base = () => env('SSLCOMMERZ_BASE_URL') || (env('SSLCOMMERZ_LIVE') === 'true' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com');

export default {
  id: 'sslcommerz',
  label: 'Card or mobile banking (SSLCommerz)',
  needsEmail: true,

  configured() {
    return Boolean(env('SSLCOMMERZ_STORE_ID') && env('SSLCOMMERZ_STORE_PASSWORD'));
  },

  async start({ order, returnUrl }) {
    const form = new URLSearchParams({
      store_id: env('SSLCOMMERZ_STORE_ID'),
      store_passwd: env('SSLCOMMERZ_STORE_PASSWORD'),
      total_amount: order.total.toFixed(2),
      currency: 'BDT',
      tran_id: order.code,
      success_url: returnUrl('success'),
      fail_url: returnUrl('fail'),
      cancel_url: returnUrl('cancel'),
      ipn_url: returnUrl('ipn'),
      cus_name: order.customer_name,
      cus_email: order.email,
      cus_add1: order.address,
      cus_city: order.city,
      cus_postcode: env('SSLCOMMERZ_DEFAULT_POSTCODE') || '1000',
      cus_country: 'Bangladesh',
      cus_phone: order.phone,
      shipping_method: 'NO',
      num_of_item: String(order.items.reduce((n, i) => n + i.qty, 0)),
      product_name: order.items.map((i) => `${i.qty} x ${i.name}`).join(', ').slice(0, 250),
      product_category: 'Beverage',
      product_profile: 'physical-goods',
    });
    const r = await fetch(`${base()}/gwprocess/v4/api.php`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const data = await r.json().catch(() => ({}));
    if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
      throw new Error(`SSLCommerz did not start the payment: ${data.failedreason || r.status}`);
    }
    return { redirectUrl: data.GatewayPageURL, providerRef: data.sessionkey || null, raw: { status: data.status } };
  },

  /** action is success, fail, cancel (customer's browser) or ipn (server-to-server). */
  async handle({ action, query, body }) {
    const p = { ...query, ...body };
    const orderCode = p.tran_id || query.order;
    const valId = p.val_id;
    if (valId) {
      const url = new URL(`${base()}/validator/api/validationserverAPI.php`);
      url.search = new URLSearchParams({ val_id: valId, store_id: env('SSLCOMMERZ_STORE_ID'), store_passwd: env('SSLCOMMERZ_STORE_PASSWORD'), format: 'json' });
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const v = await r.json().catch(() => ({}));
      const ok = (v.status === 'VALID' || v.status === 'VALIDATED') && v.tran_id === orderCode && v.currency === 'BDT';
      return {
        orderCode,
        outcome: ok ? 'paid' : 'failed',
        amount: ok ? Number(v.amount) : undefined,
        providerRef: v.bank_tran_id || valId,
        raw: { action, status: p.status, validation: v.status, amount: v.amount, tran_id: v.tran_id },
      };
    }
    if (action === 'cancel' || p.status === 'CANCELLED') return { orderCode, outcome: 'cancelled', raw: { action, status: p.status } };
    if (action === 'fail' || ['FAILED', 'EXPIRED'].includes(p.status)) return { orderCode, outcome: 'failed', raw: { action, status: p.status } };
    // A return without a validation ID: wait for the IPN to confirm.
    return { orderCode, outcome: 'pending', raw: { action, status: p.status } };
  },
};
