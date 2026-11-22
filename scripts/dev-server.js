// Local preview that behaves like Vercel: serves the static files and runs
// the functions in api/. Usage:  npm run dev   (reads .env if present)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain' };
const port = Number(process.env.PORT || 3000);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const mod = await import(join(root, 'api', `${api[1]}.js`));
      return mod.default(req, res);
    }
    const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(pub, p);
    if (!file.startsWith(pub)) throw new Error('blocked');
    if (p.endsWith('/')) file = join(file, 'index.html');
    else if (!extname(p)) file = existsSync(file + '.html') ? file + '.html' : join(file, 'index.html');
    await stat(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await readFile(join(pub, '404.html')));
  }
}).listen(port, '127.0.0.1', () => console.log(`Super Water running at http://localhost:${port}  (admin: /admin)`));
