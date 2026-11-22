/**
 * TEMPLATE for adding another payment gateway (for example Nagad, AamarPay,
 * ShurjoPay or Stripe).
 *
 * 1. Copy this file to lib/payments/<name>.js and fill in the three functions.
 * 2. Add it to the list in lib/payments/index.js.
 * 3. Add its keys as environment variables in Vercel (never in the code).
 *
 * The gateway sends customers (and, if it has one, its server-to-server
 * notification) to:
 *   https://<your-site>/api/payment?provider=<id>&action=<anything>&order=<order code>
 * returnUrl('success') builds that address for you.
 */
const env = (k) => (process.env[k] || '').trim();

export default {
  id: 'example',                // used in URLs and stored on orders
  label: 'Example gateway',     // shown to customers at checkout
  needsEmail: false,            // true if the gateway requires the customer's email

  /** Return true once all required keys are set. Unconfigured gateways are hidden. */
  configured() {
    return Boolean(env('EXAMPLE_API_KEY'));
  },

  /**
   * Start a payment. `order` has code, total (Taka), customer_name, phone, email,
   * address, city and items. Return the page to send the customer to.
   */
  async start({ order, returnUrl }) {
    throw new Error('Not implemented');
    // return { redirectUrl: 'https://gateway/pay/…', providerRef: 'their payment id' };
  },

  /**
   * Called when the gateway sends the customer back or notifies us.
   * Always confirm with the gateway's own API before returning 'paid'.
   * outcome: 'paid' | 'failed' | 'cancelled' | 'pending' (not known yet)
   */
  async handle({ action, query, body }) {
    return { orderCode: query.order, outcome: 'pending', raw: { action } };
    // return { orderCode, outcome: 'paid', amount: 720, providerRef: 'TRX123', raw: {...} };
  },
};
