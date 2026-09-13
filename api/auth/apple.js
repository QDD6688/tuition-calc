import { baseUrl, randomUrlSafe, redirect, setOAuthCookie } from '../_oauth.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.APPLE_CLIENT_ID || !process.env.APPLE_TEAM_ID || !process.env.APPLE_KEY_ID || !process.env.APPLE_PRIVATE_KEY) {
    return redirect(res, '/?auth_error=Apple+sign-in+is+being+configured.');
  }
  const state = randomUrlSafe();
  const nonce = randomUrlSafe();
  const redirectUri = `${baseUrl(req)}/api/auth/apple/callback`;
  setOAuthCookie(res, 'apple', { state, nonce, createdAt: Date.now() });
  const params = new URLSearchParams({ client_id: process.env.APPLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code id_token', response_mode: 'form_post', scope: 'name email', state, nonce });
  return redirect(res, `https://appleid.apple.com/auth/authorize?${params}`);
}
