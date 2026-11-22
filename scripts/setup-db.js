// Creates the tables, default products and the first admin account.
// The site also does this automatically on its first request, so running this
// is optional. Usage:  npm run db:setup   (reads DATABASE_URL etc. from .env)
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { db, ensureSchema } = await import('../lib/db.js');
await ensureSchema();
const sql = db();
const [{ n }] = await sql`select count(*)::int as n from users`;
console.log('Database ready.');
console.log(n ? `${n} admin account(s) exist.` : 'No admin account yet: set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) and run this again.');
await sql.end();
