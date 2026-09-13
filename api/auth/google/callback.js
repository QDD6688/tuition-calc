import { createSession, getOrCreateOAuthUser, normalizeEmail, requireRedis, setSessionCookie, validEmail } from '../../_auth.js';
import { authError, baseUrl, clearOAuthCookie, readOAuthCookie, redirect, verifyRemoteJwt } from '../../_oauth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const saved = readOAuthCookie(req, 'google');
  clearOAuthCookie(res, 'google');
  if (!saved || saved.state !== req.query.state || Date.now() - saved.createdAt > 600000) return authError(res, req, 'Google sign-in expired. Please try again.');
  if (!req.query.code) return authError(res, req, 'Google sign-in was cancelled.');
  const redis = requireRedis(res);
  if (!redis) return;

  try {
    const redirectUri = `${baseUrl(req)}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) throw new Error('Google token exchange failed');
    const claims = await verifyRemoteJwt(tokens.id_token, 'https://www.googleapis.com/oauth2/v3/certs', { issuers: ['https://accounts.google.com', 'accounts.google.com'], audience: process.env.GOOGLE_CLIENT_ID });
    const email = normalizeEmail(claims.email);
    if (!validEmail(email) || ![true, 'true'].includes(claims.email_verified)) throw new Error('Google email is not verified');
    const user = await getOrCreateOAuthUser(redis, email, 'google', claims.sub);
    setSessionCookie(res, await createSession(redis, user));
    return redirect(res, '/?auth=success');
  } catch (error) {
    console.error('Google OAuth error:', error.message);
    return authError(res, req, 'Google sign-in could not be completed.');
  }
}
