import { baseUrl, codeChallenge, randomUrlSafe, redirect, setOAuthCookie } from '../_oauth.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirect(res, '/?auth_error=Google+sign-in+is+being+configured.');
  }
  const state = randomUrlSafe();
  const verifier = randomUrlSafe(48);
  const redirectUri = `${baseUrl(req)}/api/auth/google/callback`;
  setOAuthCookie(res, 'google', { state, verifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
