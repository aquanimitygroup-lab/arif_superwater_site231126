# Payment flow test (no real money, no real gateway)

`mock-gateways.cjs` imitates SSLCommerz and bKash as their docs describe.
`run.mjs` places orders and walks through success, failure, cancellation and
wrong-amount cases against a local copy of the site.

1. `node scripts/payment-test/mock-gateways.cjs`
2. In another terminal, start the site pointed at the mock:
   `SSLCOMMERZ_STORE_ID=s SSLCOMMERZ_STORE_PASSWORD=p SSLCOMMERZ_BASE_URL=http://127.0.0.1:4555 BKASH_USERNAME=u BKASH_PASSWORD=pw BKASH_APP_KEY=k BKASH_APP_SECRET=sec BKASH_BASE_URL=http://127.0.0.1:4555/v2/tokenized-checkout PORT=3123 npm run dev`
3. Record some 500 mL stock in the admin, then `node scripts/payment-test/run.mjs`

Use a test database. This is a check of the website's own logic; still test
each gateway's real sandbox before going live.
