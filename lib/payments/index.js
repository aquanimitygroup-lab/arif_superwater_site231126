import sslcommerz from './sslcommerz.js';
import bkash from './bkash.js';

/**
 * Online payment gateways. A gateway appears at checkout only when its keys
 * are set in the environment AND "Accept online payment" is on in Admin → Content → Ordering.
 * To add another gateway, see _template.js.
 */
export const GATEWAYS = [sslcommerz, bkash];

export const COD = { id: 'cod', label: 'Cash on delivery' };

export function gateway(id) {
  return GATEWAYS.find((g) => g.id === id);
}

export function configuredGateways() {
  return GATEWAYS.filter((g) => g.configured());
}
