// Super Water admin panel. Plain JavaScript, no build step.
// All text from the server is inserted with textContent (never innerHTML).

const $ = (s, el = document) => el.querySelector(s);
const tk = (n) => `Tk ${Number(n || 0).toLocaleString('en-IN')}`;
const size = (ml) => (Number(ml) === 2000 ? '2 L' : '500 mL');
const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Builds an element: h('div', {class:'x', onclick}, 'text', child, [children]) */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

/** Replaces an element's children, skipping empty (null/false) entries. */
function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); }

async function api(action, { method = 'GET', data, params = {} } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const r = await fetch(`/api/admin?${qs}`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-SW-Admin': '1' },
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'same-origin',
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && action !== 'login') { showLogin(); throw new Error(body.error || 'Please sign in.'); }
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}
const fail = (e) => toast(e.message || String(e), true);

// ---------- sign in ----------
let me = null;
function showLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  $('#loginEmail').focus();
  checkSetup();
}
/** Shows what is missing in Vercel when the site is not ready for sign-in. */
async function checkSetup() {
  const box = $('#setupBox');
  let st;
  try {
    const r = await fetch('/api/admin?action=status', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
    st = await r.json();
  } catch {
    st = { ready: false, offline: true };
  }
  if (st.ready) { box.hidden = true; return; }
  const rows = st.offline
    ? [[false, 'The server part of the site is not running', 'The admin needs the project deployed from GitHub (or the Vercel CLI) with its api folder, not as static files only. See README step 1.']]
    : [[st.database.ok, 'Database', st.database.message], [st.session_secret.ok, 'SESSION_SECRET', st.session_secret.message], [st.admin.ok, 'Admin account', st.admin.message]];
  fill(box,
    h('h2', {}, 'The site needs setting up in Vercel'),
    h('ul', {}, rows.map(([ok, label, msg]) => h('li', {}, h('span', { class: ok ? 'ok' : 'no' }, ok ? '✓' : '✕'), h('span', {}, h('b', {}, label), ok ? '' : ` · ${msg}`)))),
    h('p', { class: 'hint', style: 'margin:0' }, 'Add missing settings under Vercel → Project → Settings → Environment Variables, then Deployments → Redeploy.'));
  box.hidden = false;
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; $('#loginError').textContent = '';
  try {
    await api('login', { method: 'POST', data: { email: $('#loginEmail').value, password: $('#loginPassword').value } });
    $('#loginPassword').value = '';
    await boot();
  } catch (err) { $('#loginError').textContent = err.message; }
  finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); me = null; showLogin(); });
$('#menuToggle').addEventListener('click', () => $('#app').classList.toggle('menu-open'));

// ---------- navigation ----------
const SECTIONS = [
  { id: 'overview', title: 'Overview', roles: ['admin', 'production'], render: renderOverview },
  { id: 'orders', title: 'Orders', roles: ['admin', 'production'], render: renderOrders },
  { id: 'inventory', title: 'Inventory', roles: ['admin', 'production'], render: renderInventory },
  { id: 'content', title: 'Website content', roles: ['admin'], render: renderContent },
  { id: 'products', title: 'Products & prices', roles: ['admin'], render: renderProducts },
  { id: 'payments', title: 'Payments & connections', roles: ['admin'], render: renderPayments },
  { id: 'people', title: 'People', roles: ['admin'], render: renderPeople },
  { id: 'account', title: 'My account', roles: ['admin', 'production'], render: renderAccount },
];
const allowed = () => SECTIONS.filter((s) => s.roles.includes(me.role));

async function boot() {
  try { ({ user: me } = await api('me')); } catch { return showLogin(); }
  $('#login').hidden = true; $('#app').hidden = false;
  $('#whoami').textContent = `${me.email} · ${me.role === 'admin' ? 'Administrator' : 'Production'}`;
  fill($('#nav'), ...allowed().map((s) => h('a', { href: `#${s.id}`, 'data-id': s.id }, s.title)));
  route();
}
window.addEventListener('hashchange', route);
function route() {
  if (!me) return;
  const id = location.hash.slice(1);
  const section = allowed().find((s) => s.id === id) || allowed()[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === section.id));
  $('#app').classList.remove('menu-open');
  $('#pageTitle').textContent = section.title;
  fill($('#pageActions'), );
  const view = $('#view');
  fill(view, h('p', { class: 'muted' }, 'Loading…'));
  section.render(view).catch((e) => { fill(view, h('div', { class: 'card' }, h('p', { class: 'form-error' }, e.message))); });
}
function actions(...els) { fill($('#pageActions'), ...els); }

// ---------- shared bits ----------
const statusPill = (s) => h('span', { class: `pill ${s}` }, s[0].toUpperCase() + s.slice(1));
const PAY_LABEL = { cod: 'Cash on delivery', sslcommerz: 'SSLCommerz', bkash: 'bKash' };

function stockTiles(stock) {
  return h('div', { class: 'stock-row' }, stock.map((s) => {
    const avail = s.on_hand - s.reserved;
    const cls = avail <= 0 ? 'out' : s.low ? 'low' : '';
    const total = Math.max(s.on_hand, 1);
    return h('div', { class: `stock ${cls}` },
      h('h3', {}, `${size(s.size_ml)} bottles`, avail <= 0 ? h('span', { class: 'pill failed' }, 'Out of stock') : s.low ? h('span', { class: 'pill pending' }, 'Running low') : h('span', { class: 'pill ok' }, 'In stock')),
      h('dl', {},
        h('div', {}, h('dt', {}, 'At facility'), h('dd', {}, s.on_hand.toLocaleString('en-IN'))),
        h('div', {}, h('dt', {}, 'Reserved'), h('dd', {}, s.reserved.toLocaleString('en-IN'))),
        h('div', {}, h('dt', {}, 'Available'), h('dd', { class: 'avail' }, avail.toLocaleString('en-IN')))),
      h('div', { class: 'meter', title: 'Reserved / available' },
        h('i', { class: 'm-res', style: `width:${Math.min(100, (s.reserved / total) * 100)}%` }),
        h('i', { class: 'm-av', style: `width:${Math.max(0, Math.min(100, (avail / total) * 100))}%` })),
      h('p', { class: 'hint' }, `Low-stock alert at ${s.low_threshold.toLocaleString('en-IN')} available`));
  }));
}

function ordersTable(rows, onOpen) {
  if (!rows.length) return h('div', { class: 'table-wrap' }, h('p', { class: 'empty' }, 'No orders here yet.'));
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Customer'), h('th', {}, 'Placed'), h('th', {}, 'Payment'), h('th', {}, 'Status'), h('th', { class: 'r' }, 'Total'))),
    h('tbody', {}, rows.map((o) => h('tr', { class: 'clickable', tabindex: 0, onclick: () => onOpen(o.id), onkeydown: (e) => e.key === 'Enter' && onOpen(o.id) },
      h('td', {}, h('b', {}, o.code)),
      h('td', {}, o.customer_name, h('div', { class: 'muted' }, o.city)),
      h('td', { class: 'muted' }, when(o.created_at)),
      h('td', {}, h('div', {}, PAY_LABEL[o.payment_method] || o.payment_method), statusPill(o.payment_status)),
      h('td', {}, statusPill(o.status)),
      h('td', { class: 'r num' }, tk(o.total)))))));
}

// ---------- overview ----------
async function renderOverview(view) {
  const d = await api('dashboard');
  const c = d.counts;
  const kpis = [
    h('div', { class: 'kpi' }, h('b', {}, c.orders_24h), h('span', {}, 'Orders in the last 24 hours')),
    h('div', { class: `kpi ${c.to_confirm ? 'attn' : ''}` }, h('b', {}, c.to_confirm), h('span', {}, 'New orders to confirm')),
    h('div', { class: `kpi ${c.to_dispatch ? 'attn' : ''}` }, h('b', {}, c.to_dispatch), h('span', {}, 'Confirmed, waiting to dispatch')),
  ];
  if (me.role === 'admin') kpis.push(h('div', { class: 'kpi' }, h('b', {}, tk(c.revenue_30d)), h('span', {}, `Paid in the last 30 days (${c.paid_30d} orders)`)));
  const gw = d.gateways.filter((g) => g.configured);
  fill(view, 
    h('div', { class: 'grid kpis' }, kpis),
    h('div', {}, h('h2', { style: 'font-size:17px;margin:4px 0 12px' }, 'Stock at the production facility'), stockTiles(d.stock)),
    h('div', {}, h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, h('h2', { style: 'font-size:17px;margin:0' }, 'Latest orders'), h('a', { href: '#orders' }, 'All orders →')),
      ordersTable(d.recent, openOrder)),
    me.role === 'admin' ? h('div', { class: 'card' }, h('h2', {}, 'Online payments'),
      h('p', { class: 'hint' }, gw.length ? `Connected: ${gw.map((g) => g.label).join(', ')}.` : 'No payment gateway is connected yet, so customers can only pay cash on delivery. See Payments & connections.')) : null,
  );
}

// ---------- orders ----------
let orderFilter = { status: '', q: '' };
async function renderOrders(view) {
  const list = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const tabs = [['', 'All'], ['pending', 'New'], ['confirmed', 'Confirmed'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
  const load = async () => {
    const { orders } = await api('orders', { params: orderFilter });
    fill(list, ordersTable(orders, openOrder));
  };
  const tabBar = h('div', { class: 'tabs' }, tabs.map(([v, label]) => h('button', {
    type: 'button', class: orderFilter.status === v ? 'on' : '',
    onclick: (e) => { orderFilter.status = v; tabBar.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); load().catch(fail); },
  }, label)));
  let t;
  const search = h('input', { type: 'search', id: 'orderSearch', placeholder: 'Search code, name or phone', value: orderFilter.q,
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { orderFilter.q = e.target.value; load().catch(fail); }, 300); } });
  actions(h('button', { class: 'btn', type: 'button', onclick: () => load().catch(fail) }, 'Refresh'));
  fill(view, h('div', { class: 'toolbar' }, tabBar, search), list);
  await load();
}

async function openOrder(id) {
  const { order: o, events } = await api('order', { params: { id } }).catch((e) => (fail(e), {}));
  if (!o) return;
  const body = $('#panelBody');
  $('#panelTitle').textContent = `Order ${o.code}`;
  const doAction = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api('order-action', { method: 'POST', data: { id: o.id, action } });
      toast('Order updated'); await openOrder(o.id); route();
    } catch (e) { fail(e); }
  };
  const btns = [];
  const isAdmin = me.role === 'admin';
  const canDispatch = ['pending', 'confirmed'].includes(o.status) && (o.payment_method === 'cod' || o.payment_status === 'paid');
  if (isAdmin && o.status === 'pending') btns.push(h('button', { class: 'btn primary', onclick: () => doAction('confirm') }, 'Confirm order'));
  if (canDispatch) btns.push(h('button', { class: 'btn accent', onclick: () => doAction('dispatch', 'Mark this order as dispatched? Its bottles will be taken out of facility stock.') }, 'Mark dispatched'));
  if (isAdmin && o.status === 'dispatched') btns.push(h('button', { class: 'btn primary', onclick: () => doAction('deliver') }, 'Mark delivered'));
  if (isAdmin && ['pending', 'confirmed'].includes(o.status)) btns.push(h('button', { class: 'btn danger', onclick: () => doAction('cancel', o.payment_status === 'paid' ? 'This order was paid online. Cancel it? You will need to refund the customer through the payment gateway.' : 'Cancel this order? Its bottles go back into available stock.') }, 'Cancel order'));
  if (isAdmin && o.payment_status !== 'paid' && o.status !== 'cancelled') btns.push(h('button', { class: 'btn small', onclick: () => doAction('mark_paid', 'Mark this order as paid?') }, 'Mark paid'));
  if (isAdmin && o.payment_status === 'paid' && o.payment_method !== 'cod') btns.push(h('button', { class: 'btn small', onclick: () => doAction('mark_refunded', 'Record that this payment was refunded?') }, 'Mark refunded'));
  if (o.payment_method !== 'cod' && o.payment_status !== 'paid' && o.status === 'pending') btns.push(h('p', { class: 'hint' }, 'Waiting for online payment. Unpaid online orders are cancelled automatically after 2 hours.'));

  fill(body, 
    h('div', { class: 'actions' }, statusPill(o.status), statusPill(o.payment_status), h('span', { class: 'muted' }, when(o.created_at))),
    btns.length ? h('div', { class: 'actions' }, btns) : null,
    h('div', {}, h('h3', {}, 'Customer'), h('dl', { class: 'kv' },
      h('dt', {}, 'Name'), h('dd', {}, o.customer_name),
      h('dt', {}, 'Phone'), h('dd', {}, h('a', { href: `tel:${o.phone}` }, o.phone)),
      h('dt', {}, 'Email'), h('dd', {}, o.email || '—'),
      h('dt', {}, 'Address'), h('dd', {}, o.address),
      h('dt', {}, 'Area / city'), h('dd', {}, o.city),
      h('dt', {}, 'Note'), h('dd', {}, o.note || '—'))),
    h('div', {}, h('h3', {}, 'Items'), h('table', { class: 'items' }, h('tbody', {}, o.items.map((i) => h('tr', {},
      h('td', {}, `${i.qty} × ${i.name}`, h('div', { class: 'muted' }, `${i.qty * i.bottles} bottles of ${size(i.size_ml)}`)),
      h('td', { class: 'r num' }, tk(i.qty * i.price)))))),
      h('div', { class: 'totals' }, h('span', {}, `Subtotal ${tk(o.subtotal)}`), h('span', {}, `Delivery ${tk(o.delivery_fee)}`), h('b', {}, `Total ${tk(o.total)}`))),
    h('div', {}, h('h3', {}, 'Payment'), h('dl', { class: 'kv' },
      h('dt', {}, 'Method'), h('dd', {}, PAY_LABEL[o.payment_method] || o.payment_method),
      h('dt', {}, 'Gateway reference'), h('dd', {}, o.provider_ref || '—'),
      h('dt', {}, 'Stock'), h('dd', {}, { reserved: 'Reserved at the facility', released: 'Returned to stock', dispatched: 'Taken out of stock' }[o.stock_state]))),
    events.length ? h('div', {}, h('h3', {}, 'Payment gateway log'), h('div', { class: 'table-wrap' }, h('table', {},
      h('tbody', {}, events.map((e) => h('tr', {}, h('td', { class: 'muted' }, when(e.created_at)), h('td', {}, `${e.provider} · ${e.kind}`), h('td', {}, e.ok ? h('span', { class: 'pill ok' }, 'OK') : h('span', { class: 'pill off' }, (e.payload && e.payload.outcome) || '—')))))))) : null,
  );
  $('#panel').hidden = false; $('#scrim').hidden = false;
}
const closePanel = () => { $('#panel').hidden = true; $('#scrim').hidden = true; };
$('#panelClose').addEventListener('click', closePanel);
$('#scrim').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closePanel());

// ---------- inventory ----------
const REASONS = { production: 'Production', stocktake: 'Stock count', adjustment: 'Adjustment', order_reserved: 'Reserved for order', order_released: 'Returned from order', order_dispatched: 'Dispatched' };

function sizeSelect(id) {
  return h('select', { id }, h('option', { value: '500' }, '500 mL'), h('option', { value: '2000' }, '2 L'));
}
function formCard(title, hint, fields, submitLabel, onSubmit) {
  const err = h('p', { class: 'form-error' });
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try { await onSubmit(form); form.reset(); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  } }, h('div', { class: 'form-grid' }, fields), err, h('button', { class: 'btn primary', type: 'submit' }, submitLabel));
  return h('div', { class: 'card' }, h('h2', {}, title), h('p', { class: 'hint' }, hint), form);
}
const fieldEl = (labelText, input) => h('div', {}, h('label', { for: input.id }, labelText), input);

async function renderInventory(view) {
  const { stock, movements } = await api('stock');
  const refresh = () => route();
  const production = formCard('Record production', 'New bottles that came off the line at the facility.', [
    fieldEl('Bottle size', sizeSelect('pSize')),
    fieldEl('Bottles produced', h('input', { type: 'number', id: 'pQty', min: 1, step: 1, required: true })),
    fieldEl('Batch number', h('input', { type: 'text', id: 'pBatch', maxlength: 60 })),
    fieldEl('Note', h('input', { type: 'text', id: 'pNote', maxlength: 300 })),
  ], 'Add to stock', async () => {
    await api('production', { method: 'POST', data: { size_ml: Number($('#pSize').value), quantity: Number($('#pQty').value), batch: $('#pBatch').value, note: $('#pNote').value } });
    toast('Production recorded'); refresh();
  });
  const count = formCard('Stock count', 'Enter what was physically counted at the facility. This replaces the "At facility" number.', [
    fieldEl('Bottle size', sizeSelect('cSize')),
    fieldEl('Bottles counted', h('input', { type: 'number', id: 'cQty', min: 0, step: 1, required: true })),
    fieldEl('Note', h('input', { type: 'text', id: 'cNote', maxlength: 300 })),
  ], 'Save count', async () => {
    const r = await api('stocktake', { method: 'POST', data: { size_ml: Number($('#cSize').value), counted: Number($('#cQty').value), note: $('#cNote').value } });
    toast(`Count saved (${r.change >= 0 ? '+' : ''}${r.change} bottles)`); refresh();
  });
  const adjust = formCard('Adjustment', 'For breakage, samples or returns. Use a negative number to remove bottles.', [
    fieldEl('Bottle size', sizeSelect('aSize')),
    fieldEl('Change (+/−)', h('input', { type: 'number', id: 'aQty', step: 1, required: true })),
    fieldEl('Reason', h('input', { type: 'text', id: 'aNote', maxlength: 300, required: true, placeholder: 'e.g. 12 bottles damaged in loading' })),
  ], 'Save adjustment', async () => {
    await api('adjust', { method: 'POST', data: { size_ml: Number($('#aSize').value), change: Number($('#aQty').value), note: $('#aNote').value } });
    toast('Adjustment saved'); refresh();
  });
  const alerts = formCard('Low-stock alerts', 'Show a warning when available bottles fall to this level.', stock.map((s) =>
    fieldEl(`${size(s.size_ml)} alert level`, h('input', { type: 'number', id: `t${s.size_ml}`, min: 0, step: 1, value: s.low_threshold }))), 'Save alert levels', async () => {
    for (const s of stock) await api('threshold', { method: 'POST', data: { size_ml: s.size_ml, low_threshold: Number($(`#t${s.size_ml}`).value) } });
    toast('Alert levels saved'); refresh();
  });

  const history = h('div', { class: 'table-wrap' }, movements.length ? h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Size'), h('th', {}, 'What happened'), h('th', { class: 'r' }, 'At facility'), h('th', { class: 'r' }, 'Reserved'), h('th', {}, 'Reference'), h('th', {}, 'By'))),
    h('tbody', {}, movements.map((m) => h('tr', {},
      h('td', { class: 'muted' }, when(m.created_at)), h('td', {}, size(m.size_ml)), h('td', {}, REASONS[m.reason] || m.reason, m.note ? h('div', { class: 'muted' }, m.note) : null),
      h('td', { class: 'r num' }, m.on_hand_change ? h('span', { class: `pill ${m.on_hand_change > 0 ? 'change-pos' : 'change-neg'}` }, `${m.on_hand_change > 0 ? '+' : ''}${m.on_hand_change}`) : '—'),
      h('td', { class: 'r num' }, m.reserved_change ? `${m.reserved_change > 0 ? '+' : ''}${m.reserved_change}` : '—'),
      h('td', {}, m.ref || '—'), h('td', { class: 'muted' }, m.actor || '—'))))) : h('p', { class: 'empty' }, 'No stock changes yet. Record the first production run above.'));

  actions(h('button', { class: 'btn', type: 'button', onclick: refresh }, 'Refresh'));
  fill(view, 
    stockTiles(stock),
    h('p', { class: 'hint', style: 'margin:-6px 0 0' }, '"Reserved" bottles belong to website orders that have not left the facility yet. "Available" is what the website can still sell.'),
    h('div', { class: 'grid two' }, production, count, adjust, alerts),
    h('div', {}, h('h2', { style: 'font-size:17px;margin:4px 0 12px' }, 'Stock history (latest 100)'), history),
  );
}

// ---------- content ----------
async function renderContent(view) {
  const { groups, defaults, values } = await api('content');
  const edits = {}; const resets = new Set();
  const current = (k) => (k in edits ? edits[k] : k in values ? values[k] : defaults[k]);
  const saveBtn = h('button', { class: 'btn accent', type: 'button', disabled: true }, 'Save changes');
  const status = h('span', {}, 'No unsaved changes');
  const update = () => {
    const n = Object.keys(edits).length + resets.size;
    saveBtn.disabled = n === 0;
    status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No unsaved changes';
  };

  const fieldFor = (f) => {
    const id = `cms-${f.key.replace(/[^a-z0-9]/gi, '-')}`;
    const wrap = h('div', { class: 'field' });
    const changed = () => wrap.classList.toggle('changed', JSON.stringify(current(f.key)) !== JSON.stringify(defaults[f.key]));
    let input;
    const onChange = (v) => { edits[f.key] = v; resets.delete(f.key); changed(); update(); };
    if (f.type === 'bool') {
      input = h('input', { type: 'checkbox', id, checked: Boolean(current(f.key)), onchange: (e) => onChange(e.target.checked) });
      wrap.append(h('label', { class: 'check', for: id }, input, f.label));
    } else {
      const isBn = f.key.endsWith('.bn');
      input = f.type === 'long' || f.type === 'lines'
        ? h('textarea', { id, rows: f.type === 'lines' ? 6 : 3, ...(isBn ? { lang: 'bn' } : {}), oninput: (e) => onChange(e.target.value) })
        : h('input', { type: f.type === 'number' ? 'number' : 'text', id, min: f.type === 'number' ? 0 : null, ...(isBn ? { lang: 'bn' } : {}), oninput: (e) => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value) });
      input.value = current(f.key) ?? '';
      const reset = h('button', { type: 'button', class: 'reset', onclick: () => {
        delete edits[f.key]; if (f.key in values) resets.add(f.key);
        input.value = defaults[f.key] ?? ''; wrap.classList.remove('changed'); update();
      } }, 'Reset to original');
      wrap.append(h('div', { class: 'field-head' }, h('label', { for: id }, f.label), reset), input);
    }
    if (f.help) wrap.append(h('p', { class: 'hint' }, f.help));
    changed();
    return wrap;
  };

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const r = await api('content-save', { method: 'POST', data: { values: edits, reset: [...resets] } });
      Object.keys(values).forEach((k) => delete values[k]); Object.assign(values, r.values);
      Object.keys(edits).forEach((k) => delete edits[k]); resets.clear(); update();
      toast('Saved. The website shows the change within about 15 seconds.');
    } catch (e) { fail(e); update(); }
  });
  window.onbeforeunload = () => (Object.keys(edits).length + resets.size ? true : undefined);

  actions(h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'Open website ↗'));
  fill(view, 
    h('p', { class: 'hint', style: 'margin:0' }, 'Edit any text on the website. Highlighted fields differ from the original. Changes go live when you press Save.'),
    ...groups.map((g, i) => {
      const changedCount = g.fields.filter((f) => f.key in values).length;
      return h('details', { class: 'cms-group', open: i === 0 },
        h('summary', {}, g.title, changedCount ? h('span', { class: 'count' }, `${changedCount} changed`) : null),
        h('div', { class: 'cms-body' }, g.note ? h('p', { class: 'cms-note' }, g.note) : null, g.fields.map(fieldFor)));
    }),
    h('div', { class: 'savebar' }, status, saveBtn),
  );
}

// ---------- products ----------
async function renderProducts(view) {
  const { products } = await api('products');
  const rows = products.map((p) => {
    const name = h('input', { type: 'text', id: `n-${p.sku}`, value: p.name, maxlength: 80 });
    const price = h('input', { type: 'number', id: `p-${p.sku}`, value: p.price, min: 0, step: 1, style: 'max-width:110px' });
    const was = h('input', { type: 'number', id: `w-${p.sku}`, value: p.was, min: 0, step: 1, style: 'max-width:110px' });
    const active = h('input', { type: 'checkbox', id: `a-${p.sku}`, checked: p.active });
    const save = h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
      try {
        await api('product-save', { method: 'POST', data: { sku: p.sku, name: name.value, price: Number(price.value), was: Number(was.value), active: active.checked } });
        toast(`${name.value} saved`);
      } catch (e) { fail(e); }
    } }, 'Save');
    return h('tr', {}, h('td', {}, name, h('div', { class: 'muted', style: 'margin-top:4px;font-size:12px' }, `${p.bottles} × ${size(p.size_ml)} · ${p.sku}`)),
      h('td', {}, price), h('td', {}, was), h('td', {}, h('label', { class: 'check', for: `a-${p.sku}` }, active, 'On sale')), h('td', {}, save));
  });
  fill(view, 
    h('p', { class: 'hint', style: 'margin:0' }, 'Prices are in Taka. "Regular price" is shown crossed out next to the sale price; set it equal to the price to hide the saving. Turn off "On sale" to hide a product from the shop. The text on each shop card is edited under Website content → Shop cards.'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Price (Tk)'), h('th', {}, 'Regular price (Tk)'), h('th', {}, 'Shop'), h('th', {}, ''))),
      h('tbody', {}, rows))),
  );
}

// ---------- payments & connections ----------
async function renderPayments(view) {
  const { gateways } = await api('gateways');
  const origin = location.origin;
  fill(view, 
    h('div', { class: 'card' }, h('h2', {}, 'How payments work'),
      h('p', { class: 'hint' }, 'Cash on delivery works now. An online gateway appears at checkout as soon as its keys are added in Vercel (Project → Settings → Environment Variables) and the site is redeployed. Switch payment methods on or off under Website content → Ordering.')),
    ...gateways.map((g) => h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('h2', {}, g.label), g.configured ? h('span', { class: 'pill ok' }, g.live ? 'Connected · live' : 'Connected · test mode') : h('span', { class: 'pill off' }, 'Not connected')),
      h('p', { class: 'hint' }, 'Environment variables:'),
      h('pre', { class: 'code' }, g.env.join('\n')),
      h('p', { class: 'hint' }, 'If the gateway asks for your website addresses, use:'),
      h('pre', { class: 'code' }, g.id === 'sslcommerz'
        ? `IPN (notification) URL: ${origin}/api/payment?provider=sslcommerz&action=ipn\nThe success, fail and cancel addresses are sent automatically with each payment.`
        : `Callback addresses are sent automatically with each payment:\n${origin}/api/payment?provider=${g.id}&action=callback`))),
    h('div', { class: 'card' }, h('h2', {}, 'Production facility connection'),
      h('p', { class: 'hint' }, 'Facility staff can sign in here with a Production account (People → Add person). If the facility has its own software, it can send production and stock counts directly using the facility API key (FACILITY_API_KEY in Vercel).'),
      h('pre', { class: 'code' }, `# Stock levels and orders waiting for dispatch
curl ${origin}/api/facility -H "Authorization: Bearer YOUR_FACILITY_API_KEY"

# Record a production batch
curl -X POST "${origin}/api/facility?action=production" \\
  -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" \\
  -d '{"size_ml":500,"quantity":2400,"batch":"B-1121"}'

# Record a physical stock count
curl -X POST "${origin}/api/facility?action=stocktake" \\
  -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" \\
  -d '{"size_ml":2000,"counted":860,"note":"Monthly count"}'`)),
  );
}

// ---------- people ----------
async function renderPeople(view) {
  const { users } = await api('users');
  const editor = h('div');
  const showEditor = (u = {}) => {
    const err = h('p', { class: 'form-error' });
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        await api('user-save', { method: 'POST', data: { id: u.id, email: $('#uEmail').value, name: $('#uName').value, role: $('#uRole').value, password: $('#uPass').value, active: $('#uActive').checked } });
        toast(u.id ? 'Account updated' : 'Account created'); route();
      } catch (x) { err.textContent = x.message; }
    } },
    h('div', { class: 'form-grid' },
      fieldEl('Email', h('input', { type: 'email', id: 'uEmail', value: u.email || '', required: true })),
      fieldEl('Name', h('input', { type: 'text', id: 'uName', value: u.name || '' })),
      fieldEl('Access', h('select', { id: 'uRole' }, h('option', { value: 'production', selected: u.role !== 'admin' }, 'Production (orders & stock)'), h('option', { value: 'admin', selected: u.role === 'admin' }, 'Administrator (everything)'))),
      fieldEl(u.id ? 'New password (leave empty to keep)' : 'Password (at least 10 characters)', h('input', { type: 'password', id: 'uPass', autocomplete: 'new-password' }))),
    h('p', {}, h('label', { class: 'check', for: 'uActive' }, h('input', { type: 'checkbox', id: 'uActive', checked: u.active !== false }), 'Can sign in')),
    err, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, u.id ? 'Save' : 'Create account'), h('button', { class: 'btn', type: 'button', onclick: () => fill(editor, ) }, 'Close')));
    fill(editor, h('div', { class: 'card' }, h('h2', {}, u.id ? `Edit ${u.email}` : 'Add a person'), h('p', { class: 'hint' }, 'Give production staff "Production" access: they can see and dispatch orders and record stock, but cannot change the website or prices.'), form));
  };
  actions(h('button', { class: 'btn primary', type: 'button', onclick: () => showEditor() }, 'Add person'));
  fill(view, editor, h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Name'), h('th', {}, 'Access'), h('th', {}, 'Status'), h('th', {}, ''))),
    h('tbody', {}, users.map((u) => h('tr', {}, h('td', {}, u.email), h('td', {}, u.name || '—'), h('td', {}, u.role === 'admin' ? 'Administrator' : 'Production'),
      h('td', {}, u.active ? h('span', { class: 'pill ok' }, 'Active') : h('span', { class: 'pill off' }, 'Disabled')),
      h('td', { class: 'r' }, h('button', { class: 'btn small', type: 'button', onclick: () => showEditor(u) }, 'Edit'))))))));
}

// ---------- my account ----------
async function renderAccount(view) {
  fill(view, formCard('Change password', `Signed in as ${me.email}. Changing your password signs you out everywhere else.`, [
    fieldEl('Current password', h('input', { type: 'password', id: 'curPass', autocomplete: 'current-password', required: true })),
    fieldEl('New password (at least 10 characters)', h('input', { type: 'password', id: 'newPass', autocomplete: 'new-password', required: true })),
  ], 'Change password', async () => {
    await api('password', { method: 'POST', data: { current: $('#curPass').value, next: $('#newPass').value } });
    toast('Password changed');
  }));
}

boot();
