import { getSessionUser } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const user = await getSessionUser(req);
    return res.status(200).json({ user: user ? { id: user.id, email: user.email } : null });
  } catch (error) {
    console.error('Session check error:', error.message);
    return res.status(200).json({ user: null });
  }
}
