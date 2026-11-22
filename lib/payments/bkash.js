/**
 * bKash Tokenized Checkout (without agreement).
 * https://developer.bka.sh/
 *
 * Environment variables:
 *   BKASH_USERNAME, BKASH_PASSWORD     merchant credentials (sent as headers)
 *   BKASH_APP_KEY, BKASH_APP_SECRET    app credentials
 *   BKASH_BASE_URL                     defaults to the sandbox:
 *                                      https://tokenized.sandbox.bka.sh/v2/tokenized-checkout
 *                                      For live payments, set the live base URL bKash gives you at onboarding.
 *
 * Flow: get a token (cached in the database: bKash blocks apps that request
 * tokens too often), create a payment and send the customer to bkashURL.
 * bKash returns them to our callback with ?paymentID=…&status=success|failure|cancel.
 * On success we execute the payment; it only counts when transactionStatus is "Completed".
 */
const env = (k) => (process.env[k] || '').trim();
const base = () => (env('BKASH_BASE_URL') || 'https://tokenized.sandbox.bka.sh/v2/tokenized-checkout').replace(/\/$/, '');

async function call(path, { headers = {}, body }) {
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({}));
  return data;
}

async function token(sql) {
  const [row] = await sql`select value from app_state where key = 'bkash_token'`;
  const saved = row?.value;
  if (saved?.id_token && saved.expires_at > Date.now() + 5 * 60e3) return saved.id_token;

  const auth = { username: env('BKASH_USERNAME'), password: env('BKASH_PASSWORD') };
  const creds = { app_key: env('BKASH_APP_KEY'), app_secret: env('BKASH_APP_SECRET') };
  let data;
  if (saved?.refresh_token && saved.refresh_expires_at > Date.now()) {
    data = await call('/auth/refresh-token', { headers: auth, body: { ...creds, refresh_token: saved.refresh_token } });
  }
  if (!data?.id_token) data = await call('/auth/grant-token', { headers: auth, body: creds });
  if (!data?.id_token) throw new Error(`bKash refused the token request: ${data?.statusMessage || data?.errorMessageEn || 'no token returned'}`);

  const value = {
    id_token: data.id_token,
    refresh_token: data.refresh_token || saved?.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    refresh_expires_at: data.refresh_token ? Date.now() + 29 * 24 * 3600e3 : saved?.refresh_expires_at,
  };
  await sql`insert into app_state (key, value) values ('bkash_token', ${sql.json(value)})
            on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return value.id_token;
}

const authHeaders = (t) => ({ Authorization: t, 'X-App-Key': env('BKASH_APP_KEY') });

export default {
  id: 'bkash',
  label: 'bKash',
  needsEmail: false,

  configured() {
    return ['BKASH_USERNAME', 'BKASH_PASSWORD', 'BKASH_APP_KEY', 'BKASH_APP_SECRET'].every((k) => env(k));
  },

  async start({ order, returnUrl, sql }) {
    const t = await token(sql);
    const data = await call('/payment/create', {
      headers: authHeaders(t),
      body: {
        payerReference: order.phone,
        callbackURL: returnUrl('callback'),
        amount: order.total.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: order.code,
      },
    });
    const paymentId = data.paymentId || data.paymentID;
    if (!paymentId || !data.bkashURL) throw new Error(`bKash did not start the payment: ${data.statusMessage || data.errorMessageEn || 'no payment link returned'}`);
    return { redirectUrl: data.bkashURL, providerRef: paymentId, raw: { transactionStatus: data.transactionStatus } };
  },

  async handle({ query, sql }) {
    const orderCode = query.order;
    const paymentId = query.paymentID || query.paymentId;
    if (query.status === 'cancel') return { orderCode, outcome: 'cancelled', raw: { status: query.status } };
    if (query.status !== 'success' || !paymentId) return { orderCode, outcome: 'failed', raw: { status: query.status } };

    const t = await token(sql);
    let result = await call('/payment/execute', { headers: authHeaders(t), body: { paymentId } }).catch(() => null);
    if (!result || !result.transactionStatus) {
      // bKash advises checking the status if execute gives no clear answer.
      result = await call('/query/payment', { headers: authHeaders(t), body: { paymentId } }).catch(() => ({}));
    }
    const invoice = result.merchantInvoiceNumber || result.merchantInvoice;
    const ok = result.transactionStatus === 'Completed' && (!invoice || invoice === orderCode);
    return {
      orderCode,
      outcome: ok ? 'paid' : 'failed',
      amount: ok ? Number(result.amount) : undefined,
      providerRef: result.trxId || paymentId,
      raw: { status: query.status, transactionStatus: result.transactionStatus, trxId: result.trxId, amount: result.amount, message: result.statusMessage || result.errorMessageEn },
    };
  },
};
