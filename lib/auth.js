import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { db } from './db.js';
import { HttpError, cookies, clientIp } from './http.js';

const COOKIE = 'sw_session';
const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, 'SESSION_SECRET is not set (it needs at least 32 characters). Add it in your Vercel project settings.');
  return s;
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret()).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function unsign(token) {
  const [data, mac] = String(token || '').split('.');
  if (!data || !mac) return null;
  const expected = createHmac('sha256', secret()).update(data).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

export function sessionCookie(user, req) {
  const token = sign({ uid: user.id, v: user.password_hash.slice(-12), exp: Date.now() + SESSION_HOURS * 3600e3 });
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Returns the signed-in user or throws 401/403.
 * Changing a password signs out every existing session for that user.
 */
export async function requireUser(req, roles = ['admin']) {
  const payload = unsign(cookies(req)[COOKIE]);
  if (!payload) throw new HttpError(401, 'Please sign in.');
  const [user] = await db()`select id, email, name, role, password_hash, active from users where id = ${payload.uid}`;
  if (!user || !user.active || user.password_hash.slice(-12) !== payload.v) throw new HttpError(401, 'Your session has ended. Please sign in again.');
  if (!roles.includes(user.role)) throw new HttpError(403, 'Your account does not have access to this.');
  // Extra protection against cross-site requests for anything that changes data.
  if (req.method !== 'GET' && req.headers['x-sw-admin'] !== '1') throw new HttpError(403, 'Request blocked.');
  delete user.password_hash;
  return user;
}

/** Allows 10 failed sign-ins per address per 15 minutes. */
export async function checkLoginRate(req) {
  const sql = db();
  const ip = clientIp(req);
  await sql`delete from login_attempts where at < now() - interval '1 day'`;
  const [{ n }] = await sql`select count(*)::int as n from login_attempts where ip = ${ip} and at > now() - interval '15 minutes'`;
  if (n >= 10) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  return async () => { await sql`insert into login_attempts (ip) values (${ip})`; };
}

/** Constant-time check of the production facility's API key. */
export function requireFacilityKey(req) {
  const key = process.env.FACILITY_API_KEY;
  if (!key || key.length < 24) throw new HttpError(503, 'FACILITY_API_KEY is not set (it needs at least 24 characters).');
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Invalid or missing facility API key.');
}
