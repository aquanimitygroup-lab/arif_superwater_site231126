// Fake SSLCommerz + bKash that answer as their docs describe.
const http = require('http');
const sessions = {}; const bk = {}; let grants = 0;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  for await (const c of req) body += c;
  const j = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname === '/gwprocess/v4/api.php') {
    const f = Object.fromEntries(new URLSearchParams(body));
    const required = ['store_id','store_passwd','total_amount','currency','tran_id','success_url','fail_url','cancel_url','cus_name','cus_email','cus_city','cus_postcode','cus_country','cus_phone','shipping_method','product_name','product_category','product_profile'];
    const missing = required.filter(k => !f[k]);
    if (missing.length) return j({ status: 'FAILED', failedreason: 'missing ' + missing.join(',') });
    sessions[f.tran_id] = f; return j({ status: 'SUCCESS', sessionkey: 'SK-' + f.tran_id, GatewayPageURL: 'https://mock.gateway/pay/' + f.tran_id });
  }
  if (url.pathname === '/validator/api/validationserverAPI.php') {
    const v = url.searchParams.get('val_id'); const [tran, amt] = v.split('|');
    if (!sessions[tran]) return j({ status: 'INVALID_TRANSACTION' });
    return j({ status: 'VALID', tran_id: tran, amount: amt || sessions[tran].total_amount, currency: 'BDT', bank_tran_id: 'BANK-' + tran });
  }
  const b = body ? JSON.parse(body) : {};
  if (url.pathname.endsWith('/auth/grant-token')) {
    grants++; if (req.headers.username !== 'u' || b.app_key !== 'k') return j({ statusCode: '2001', statusMessage: 'bad creds' });
    return j({ statusCode: '0000', id_token: 'TOKEN', refresh_token: 'R', expires_in: 3600, token_type: 'Bearer' });
  }
  if (url.pathname.endsWith('/payment/create')) {
    if (req.headers.authorization !== 'TOKEN' || req.headers['x-app-key'] !== 'k') return j({ statusCode: '2079', statusMessage: 'Invalid token' });
    const id = 'PAY-' + b.merchantInvoiceNumber; bk[id] = b;
    return j({ statusCode: '0000', paymentId: id, bkashURL: 'https://mock.bkash/pay/' + id, transactionStatus: 'Initiated', amount: b.amount, merchantInvoiceNumber: b.merchantInvoiceNumber });
  }
  if (url.pathname.endsWith('/payment/execute')) {
    const p = bk[b.paymentId]; if (!p) return j({ statusCode: '2056', statusMessage: 'Invalid payment' });
    return j({ statusCode: '0000', paymentId: b.paymentId, trxId: 'TRX1', transactionStatus: 'Completed', amount: p.amount, currency: 'BDT', merchantInvoiceNumber: p.merchantInvoiceNumber });
  }
  if (url.pathname === '/grants') return j({ grants });
  res.statusCode = 404; res.end('{}');
}).listen(4555, '127.0.0.1', () => console.log('mock on 4555'));
