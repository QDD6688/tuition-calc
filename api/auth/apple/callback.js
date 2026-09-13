import { createSession, getOrCreateOAuthUser, normalizeEmail, requireRedis, setSessionCookie, validEmail } from '../../_auth.js';
import { authError, baseUrl, clearOAuthCookie, createAppleClientSecret, readOAuthCookie, redirect, verifyRemoteJwt } from '../../_oauth.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
  const saved = readOAuthCookie(req, 'apple');
  clearOAuthCookie(res, 'apple');
  if (!saved || saved.state !== body.state || Date.now() - saved.createdAt > 600000) return authError(res, req, 'Apple sign-in expired. Please try again.');
  if (!body.code) return authError(res, req, 'Apple sign-in was cancelled.');
  const redis = requireRedis(res);
  if (!redis) return;

  try {
    const redirectUri = `${baseUrl(req)}/api/auth/apple/callback`;
    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.APPLE_CLIENT_ID, client_secret: createAppleClientSecret(), code: body.code, grant_type: 'authorization_code', redirect_uri: redirectUri })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) throw new Error('Apple token exchange failed');
    const claims = await verifyRemoteJwt(tokens.id_token, 'https://appleid.apple.com/auth/keys', { issuer: 'https://appleid.apple.com', audience: process.env.APPLE_CLIENT_ID, nonce: saved.nonce });
    const email = normalizeEmail(claims.email);
    if (!validEmail(email) || ![true, 'true'].includes(claims.email_verified)) throw new Error('Apple email is not verified');
    const user = await getOrCreateOAuthUser(redis, email, 'apple', claims.sub);
    setSessionCookie(res, await createSession(redis, user));
    return redirect(res, '/?auth=success');
  } catch (error) {
    console.error('Apple OAuth error:', error.message);
    return authError(res, req, 'Apple sign-in could not be completed.');
  }
}
