import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getRedis } from './_redis.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = '__Host-ct_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128;
}

export function userKey(email) {
  const digest = createHash('sha256').update(email).digest('hex');
  return `auth:user:${digest}`;
}

function sessionKey(token) {
  const digest = createHash('sha256').update(token).digest('hex');
  return `auth:session:${digest}`;
}

function parseStored(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return '';
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createUser(redis, email, password) {
  const user = {
    id: randomUUID(),
    email,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  };
  const result = await redis.set(userKey(email), JSON.stringify(user), { nx: true });
  return result === 'OK' ? user : null;
}

export async function getUserByEmail(redis, email) {
  return parseStored(await redis.get(userKey(email)));
}

export async function getOrCreateOAuthUser(redis, email, provider, providerId) {
  const existing = await getUserByEmail(redis, email);
  if (existing) return existing;

  const user = {
    id: randomUUID(),
    email,
    passwordHash: null,
    provider,
    providerId,
    createdAt: new Date().toISOString()
  };
  const result = await redis.set(userKey(email), JSON.stringify(user), { nx: true });
  return result === 'OK' ? user : getUserByEmail(redis, email);
}

export async function createSession(redis, user) {
  const token = randomBytes(32).toString('base64url');
  await redis.set(sessionKey(token), JSON.stringify({
    id: user.id,
    email: user.email,
    createdAt: new Date().toISOString()
  }), { ex: SESSION_TTL_SECONDS });
  return token;
}

export function setSessionCookie(res, token) {
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? (Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]) : cookie);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export async function destroySession(req, redis) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await redis.del(sessionKey(token));
}

export async function getSessionUser(req) {
  const redis = getRedis();
  if (!redis) return null;
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return parseStored(await redis.get(sessionKey(token)));
}

export async function requireAuth(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in required' });
    return null;
  }
  return user;
}

export function requireRedis(res) {
  const redis = getRedis();
  if (!redis) {
    res.status(503).json({ error: 'Account service is temporarily unavailable' });
    return null;
  }
  return redis;
}
