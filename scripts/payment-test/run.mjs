const B = 'http://127.0.0.1:3123';
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const cust = { name: 'Pay Tester', phone: '01912345678', address: 'Road 7, Banani, Dhaka', city: 'Dhaka', email: 'buyer@example.com' };
const avail = async () => (await (await fetch(B + '/api/site?action=content')).json()).available['500'];
const order = async (method, extra = {}) => { const r = await fetch(B + '/api/site?action=order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cust, ...extra, payment_method: method, items: [{ sku: 'single-500', qty: 3 }] }) }); return { status: r.status, ...(await r.json()) }; };
const view = async (o) => (await (await fetch(`${B}/api/site?action=order&code=${o.code}&token=${o.token}`)).json());
const post = (path, form) => fetch(B + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

// SSLCommerz success
let a0 = await avail();
let o = await order('sslcommerz');
ok(o.status === 201 && o.redirectUrl === `https://mock.gateway/pay/${o.code}`, 'SSLCommerz: payment session created, customer sent to gateway');
ok(await avail() === a0 - 3, 'SSLCommerz: 3 bottles reserved while paying');
ok((await view(o)).payment_status === 'pending', 'SSLCommerz: order waits for payment');
let r = await post(`/api/payment?provider=sslcommerz&action=success&order=${o.code}`, { val_id: `${o.code}|${o.total}.00`, tran_id: o.code, status: 'VALID' });
ok(r.status === 303 && r.headers.get('location').startsWith(`/order?code=${o.code}&token=`), 'SSLCommerz: customer returned to their order page');
let v = await view(o);
ok(v.payment_status === 'paid' && v.status === 'confirmed', 'SSLCommerz: validated payment marks order paid and confirmed');
r = await post(`/api/payment?provider=sslcommerz&action=ipn&order=${o.code}`, { val_id: `${o.code}|${o.total}.00`, tran_id: o.code, status: 'VALID' });
ok(r.status === 200 && (await view(o)).payment_status === 'paid', 'SSLCommerz: repeated notification (IPN) is harmless');

// SSLCommerz amount tampering
const aBefore = await avail();
o = await order('sslcommerz');
await post(`/api/payment?provider=sslcommerz&action=success&order=${o.code}`, { val_id: `${o.code}|1.00`, tran_id: o.code });
v = await view(o);
ok(v.payment_status === 'failed' && v.status === 'cancelled', 'SSLCommerz: payment for the wrong amount is rejected and the order cancelled');
ok(await avail() === aBefore, 'SSLCommerz: its bottles go back to stock');

// SSLCommerz fail -> stock back
a0 = await avail();
o = await order('sslcommerz');
await post(`/api/payment?provider=sslcommerz&action=fail&order=${o.code}`, { tran_id: o.code, status: 'FAILED' });
v = await view(o);
ok(v.status === 'cancelled' && v.payment_status === 'failed' && await avail() === a0, 'SSLCommerz: failed payment cancels order and returns stock');

// SSLCommerz needs email
ok((await order('sslcommerz', { email: '' })).status === 400, 'SSLCommerz: email is required');

// bKash success
o = await order('bkash', { email: '' });
ok(o.status === 201 && o.redirectUrl === `https://mock.bkash/pay/PAY-${o.code}`, 'bKash: payment created, customer sent to bKash');
r = await fetch(`${B}/api/payment?provider=bkash&action=callback&order=${o.code}&paymentID=PAY-${o.code}&status=success`, { redirect: 'manual' });
v = await view(o);
ok(r.status === 303 && v.payment_status === 'paid' && v.status === 'confirmed', 'bKash: executed payment marks order paid');

// bKash cancel
a0 = await avail();
o = await order('bkash');
await fetch(`${B}/api/payment?provider=bkash&action=callback&order=${o.code}&paymentID=PAY-${o.code}&status=cancel`, { redirect: 'manual' });
v = await view(o);
ok(v.status === 'cancelled' && await avail() === a0, 'bKash: cancelled payment cancels order and returns stock');

// token reuse
o = await order('bkash');
const grants = (await (await fetch('http://127.0.0.1:4555/grants')).json()).grants;
ok(grants === 1, `bKash: access token reused (${grants} token request for 3 payments)`);

// forged callback for a COD order is ignored
o = await order('cod');
await fetch(`${B}/api/payment?provider=bkash&action=callback&order=${o.code}&paymentID=PAY-${o.code}&status=success`, { redirect: 'manual' });
ok((await view(o)).payment_status === 'unpaid', 'A gateway message cannot mark a cash-on-delivery order as paid');

console.log(fails ? `${fails} failed` : 'All payment checks passed');
