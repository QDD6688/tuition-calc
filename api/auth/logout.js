import { clearSessionCookie, destroySession, requireRedis } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).end();
  const redis = requireRedis(res);
  if (!redis) return;
  try { await destroySession(req, redis); } catch (error) { console.error('Logout error:', error.message); }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
