import { checkRateLimit, getClientIp } from '../_rate-limit.js';
import { createSession, getUserByEmail, normalizeEmail, requireRedis, setSessionCookie, validEmail, validPassword, verifyPassword } from '../_auth.js';

const DUMMY_HASH = 'scrypt:9d74448949534dcfb749260c2f5bb565:2cba1d873b26b45f6058697060a5dd45ff708d3117913560f849f75f1c94fe7fa208e1fa7aa3b6c26ebb3f8e094872e279fa43257d09b049783351c52b39cbf4';
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).end();

  const redis = requireRedis(res);
  if (!redis) return;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    if (!validEmail(email) || !validPassword(password)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const identifier = `${getClientIp(req)}:${email}`;
    if (!(await checkRateLimit({ namespace: 'login', identifier, limit: 10, windowMs: 900000 }))) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
    const user = await getUserByEmail(redis, email);
    const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const token = await createSession(redis, user);
    setSessionCookie(res, token);
    return res.status(200).json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Could not sign you in.' });
  }
}
