import { hashPassword } from './auth.js';

// Starting product list and prices. After the first run, change prices in
// Admin → Products & prices; this list is only used to fill an empty table.
export const DEFAULT_PRODUCTS = [
  { sku: 'single-500', name: 'Single · 500 mL', size_ml: 500, bottles: 1, price: 30, was: 35, sort: 1 },
  { sku: 'day-500', name: 'Day Pack · 4 × 500 mL', size_ml: 500, bottles: 4, price: 120, was: 140, sort: 2 },
  { sku: 'case-500', name: 'Case · 24 × 500 mL', size_ml: 500, bottles: 24, price: 720, was: 840, sort: 3 },
  { sku: 'single-2000', name: 'Single · 2 L', size_ml: 2000, bottles: 1, price: 90, was: 100, sort: 4 },
  { sku: 'case-2000', name: 'Case · 6 × 2 L', size_ml: 2000, bottles: 6, price: 540, was: 600, sort: 5 },
  { sku: 'case5-2000', name: '5 cases · 30 × 2 L', size_ml: 2000, bottles: 30, price: 2700, was: 3000, sort: 6 },
];

export async function seedDefaults(sql) {
  for (const p of DEFAULT_PRODUCTS) {
    await sql`insert into products ${sql(p)} on conflict (sku) do nothing`;
  }
  await sql`insert into stock (size_ml) values (500), (2000) on conflict do nothing`;

  // First administrator, created from environment variables when no one exists yet.
  const [{ n }] = await sql`select count(*)::int as n from users`;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (n === 0 && email && password.length >= 10) {
    await sql`insert into users (email, name, role, password_hash)
              values (${email}, 'Administrator', 'admin', ${hashPassword(password)})
              on conflict (email) do nothing`;
  }
}
