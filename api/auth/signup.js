import { checkRateLimit, getClientIp } from '../_rate-limit.js';
import { createSession, createUser, normalizeEmail, requireRedis, setSessionCookie, validEmail, validPassword } from '../_auth.js';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).end();

  const redis = requireRedis(res);
  if (!redis) return;
  const ip = getClientIp(req);
  if (!(await checkRateLimit({ namespace: 'signup', identifier: ip, limit: 5, windowMs: 3600000 }))) {
    return res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!validPassword(password)) return res.status(400).json({ error: 'Password must be 10–128 characters.' });
    if (body?.ageConfirmed !== true) return res.status(400).json({ error: 'You must confirm that you are at least 13.' });

    const user = await createUser(redis, email, password);
    if (!user) return res.status(409).json({ error: 'An account with this email already exists.' });
    const token = await createSession(redis, user);
    setSessionCookie(res, token);
    return res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Signup error:', error.message);
    return res.status(500).json({ error: 'Could not create your account.' });
  }
}
