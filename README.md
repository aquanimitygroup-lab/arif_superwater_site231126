# Super Water website

The Super Water website with three systems behind it:

- **Content management.** Change any text on the website, prices, shop cards, delivery charges and an announcement bar, without touching code.
- **Orders and inventory.** Website orders reserve stock at the production facility, dispatching an order takes the bottles out, and every stock change is logged.
- **Payments.** Cash on delivery works now. SSLCommerz and bKash are already built in and switch on as soon as you add their keys. Other gateways can be added from a template.

Everything runs on Vercel with a Postgres database. There is no build step.

---

## 1. Put it on Vercel

You need a Vercel account and a GitHub account.

1. **Upload the code to GitHub.** Create a new private repository and upload everything in this folder **except** `node_modules` and `.env`.
2. **Import it into Vercel.** Vercel → **Add New… → Project → Import** your repository. Framework Preset: **Other**. Leave the build settings empty (the project's `vercel.json` already sets them).
3. **Add a database.** In the new project: **Storage → Create Database → Neon (Postgres)** → connect it to the project. This adds `DATABASE_URL` for you.
4. **Add the settings.** **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `SESSION_SECRET` | Random text, 32+ characters (see `.env.example` for a command that makes one) |
   | `ADMIN_EMAIL` | Your email, for the first admin account |
   | `ADMIN_PASSWORD` | A password with 10+ characters |
   | `FACILITY_API_KEY` | Random text, 24+ characters (only if the facility's software will connect) |

5. **Deploy.** Go to **Deployments → Redeploy** so the new settings take effect.
6. **Sign in** at `https://your-site.vercel.app/admin` with the email and password from step 4. The tables, products and your account are created automatically on the first visit.
7. **Record your stock.** Admin → **Inventory** → **Stock count** for 500 mL and 2 L. Until you do, the shop shows every product as "Out of stock".

After your first sign-in you can delete `ADMIN_PASSWORD` from Vercel; change your password under **My account**.

To use your own domain: Vercel → **Settings → Domains**.

## 2. The admin panel (`/admin`)

| Section | What it's for |
|---|---|
| **Overview** | Orders today, orders to confirm and dispatch, money received, stock at the facility |
| **Orders** | Every order. Open one to confirm, dispatch, mark delivered, cancel or mark paid/refunded |
| **Inventory** | Stock per bottle size, record production, stock counts, adjustments, low-stock alerts, full history |
| **Website content** | Every text on the website, the scrolling strip, shop cards, footer, announcement bar, delivery charge, payment options and delivery areas |
| **Products & prices** | Sale price, crossed-out regular price, and whether each product is on sale |
| **Payments & connections** | Which gateways are connected, what to set up, and the facility connection details |
| **People** | Add staff. **Administrator** = everything. **Production** = orders, dispatch and stock only (for facility staff) |
| **My account** | Change your password |

Content changes appear on the website within about 15 seconds. If the database is ever unreachable, the website still shows its built-in text and prices; only ordering pauses.

## 3. How stock works

Stock is counted in **bottles** per size (500 mL and 2 L) at the production facility.

- **At facility:** bottles physically there.
- **Reserved:** bottles promised to website orders that haven't left yet.
- **Available:** at facility minus reserved. This is what the website can still sell.

| Event | What happens to stock |
|---|---|
| Customer places an order | Bottles become **reserved**. A Day Pack reserves 4 × 500 mL, a 5-case order reserves 30 × 2 L, and so on. |
| Order is cancelled, or an online payment fails | Reserved bottles go back to **available** |
| Order is marked **dispatched** | Bottles leave the facility: at facility and reserved both go down |
| Production run recorded | At facility goes up |
| Stock count | At facility is set to the counted number |

When a size runs out, its shop cards switch to "Out of stock" automatically. The website never sells more than is available, even when many people order at once. Unpaid online orders release their bottles after 2 hours.

### Connecting the production facility

Facility staff can simply sign in to `/admin` with a **Production** account.

If the facility has its own software or a spreadsheet tool, it can talk to the website directly using `FACILITY_API_KEY`:

```bash
curl https://your-site.vercel.app/api/facility -H "Authorization: Bearer YOUR_FACILITY_API_KEY"
```

```bash
curl -X POST "https://your-site.vercel.app/api/facility?action=production" -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" -d '{"size_ml":500,"quantity":2400,"batch":"B-1121"}'
```

```bash
curl -X POST "https://your-site.vercel.app/api/facility?action=stocktake" -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" -d '{"size_ml":2000,"counted":860,"note":"Monthly count"}'
```

The first returns stock levels and the list of orders waiting to be dispatched.

## 4. Payments

**Cash on delivery** is on by default. Marking a COD order **delivered** also marks it paid.

**To switch on an online gateway**, add its keys in Vercel → Settings → Environment Variables, then redeploy. It appears at checkout straight away.

| Gateway | Variables |
|---|---|
| SSLCommerz (cards, mobile banking, internet banking) | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`. Add `SSLCOMMERZ_LIVE=true` for real payments; without it, the SSLCommerz sandbox is used. |
| bKash | `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`. Without `BKASH_BASE_URL` the bKash sandbox is used; for live payments set it to the live address bKash gives you. |

Both start in test mode. Test with the gateway's sandbox credentials first, then switch to live. If SSLCommerz asks for an IPN address, use `https://your-site/api/payment?provider=sslcommerz&action=ipn`.

A payment only counts after the website checks it directly with the gateway. Payments for the wrong amount are rejected. Every message from a gateway is logged on the order.

**Another gateway** (Nagad, AamarPay, ShurjoPay, Stripe…): copy `lib/payments/_template.js`, fill in its three functions, and add it to `lib/payments/index.js`.

You can turn cash on delivery or online payment on and off under **Website content → Ordering**.

## 5. Changing the code later

```
public/          the website, admin panel and order page (what visitors download)
  index.html       the website
  admin/           the admin panel
  order.html       a customer's order status page
api/             server functions (Vercel runs each file as an endpoint)
  site.js          content, stock and placing orders
  admin.js         everything the admin panel does
  payment.js       where payment gateways return to
  facility.js      the production facility's API
lib/             shared server code: database, sign-in, stock, orders, payments
  cms-schema.js    the list of editable fields shown in Website content
db/schema.js     database tables
scripts/         local preview, database setup, tests
```

**Adding an editable field:** give the element on the page a `data-cms="some.key"` attribute, add the key to `lib/cms-schema.js`, then run `node scripts/extract-defaults.js` (it checks every field matches the page).

**Running it on your computer** (needs Node.js 20+ and a Postgres database):

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env`, then:

```bash
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/admin.

**Automated check** (uses a test database: it records production and places test orders):

```bash
npm test
```

## 6. Before you launch

- **Record real stock** under Inventory, or the shop shows everything as out of stock.
- **Delivery charge and areas:** Website content → Ordering.
- **Test a payment** in each gateway's sandbox before switching to live.
- **Link preview image:** add a 1200 × 630 image and an `og:image` tag (search `TODO: add og:image` in `public/index.html`).
- **Partner logos:** get permission and high-resolution files from BUET, CGHR and BADAS.
- **2 L photo:** the 2 L options still show the 500 mL bottle.
- **Claims review:** have your regulatory adviser check "Clinically proven", "patented" and the trial figures.
- **Privacy:** orders store customers' names, phone numbers and addresses. Add a privacy notice and keep admin access to the people who need it.
