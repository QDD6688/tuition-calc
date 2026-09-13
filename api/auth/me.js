import { getSessionUser } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).end();
  const providers = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY)
  };
  try {
    const user = await getSessionUser(req);
    return res.status(200).json({ user: user ? { id: user.id, email: user.email } : null, providers });
  } catch (error) {
    console.error('Session check error:', error.message);
    return res.status(200).json({ user: null, providers });
  }
}
