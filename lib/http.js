import { HttpError } from './db.js';

export { HttpError };

/** Wraps a Vercel function: JSON errors, no caching of private data. */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) {
        send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong on the server. Please try again.' : e.message });
      }
    }
  };
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!headers['Cache-Control']) res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

/** Reads a JSON or form-encoded body. Works on Vercel (pre-parsed) and plain Node. */
export async function body(req) {
  if (req.body !== undefined && req.body !== null && !(typeof req.body === 'string' && req.body === '')) {
    if (typeof req.body === 'string') return parse(req.body, req.headers['content-type']);
    if (Buffer.isBuffer(req.body)) return parse(req.body.toString('utf8'), req.headers['content-type']);
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 200_000) throw new HttpError(413, 'Request is too large.');
    chunks.push(c);
  }
  return parse(Buffer.concat(chunks).toString('utf8'), req.headers['content-type']);
}

function parse(text, type = '') {
  if (!text) return {};
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
}

export function method(req, ...allowed) {
  if (!allowed.includes(req.method)) throw new HttpError(405, `Use ${allowed.join(' or ')} for this request.`);
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

/** The public address of the site, used for payment return links. */
export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// ---------- small validators ----------
export function str(v, { name, max = 200, required = false, min = 0 } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${name} is required.`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (maximum ${max} characters).`);
  if (s && s.length < min) throw new HttpError(400, `${name} is too short.`);
  return s;
}

export function int(v, { name, min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number.`);
  if (n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}.`);
  return n;
}
