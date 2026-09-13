import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

const OAUTH_TTL_SECONDS = 10 * 60;

export function baseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`;
}

export function oauthCookieName(provider) {
  return `__Host-ct_oauth_${provider}`;
}

export function randomUrlSafe(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function codeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function setOAuthCookie(res, provider, payload) {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sameSite = provider === 'apple' ? 'None' : 'Lax';
  appendCookie(res, `${oauthCookieName(provider)}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${OAUTH_TTL_SECONDS}`);
}

export function clearOAuthCookie(res, provider) {
  const sameSite = provider === 'apple' ? 'None' : 'Lax';
  appendCookie(res, `${oauthCookieName(provider)}=; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=0`);
}

function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? (Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]) : cookie);
}

export function readOAuthCookie(req, provider) {
  const name = oauthCookieName(provider);
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0 || pair.slice(0, index).trim() !== name) continue;
    try {
      return JSON.parse(Buffer.from(pair.slice(index + 1).trim(), 'base64url').toString('utf8'));
    } catch { return null; }
  }
  return null;
}

export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', location);
  res.end();
}

export function authError(res, req, message) {
  redirect(res, `${baseUrl(req)}/?auth_error=${encodeURIComponent(message)}`);
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export async function verifyRemoteJwt(token, jwksUrl, expected) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid identity token');
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported identity token');

  const response = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Could not verify identity token');
  const { keys = [] } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Identity key not found');
  const valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new Error('Invalid identity signature');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const issuers = expected.issuers || [expected.issuer];
  if (!issuers.includes(payload.iss) || !audiences.includes(expected.audience) || Number(payload.exp) <= now) {
    throw new Error('Expired or invalid identity token');
  }
  if (expected.nonce && payload.nonce !== expected.nonce) throw new Error('Invalid identity nonce');
  return payload;
}

export function createAppleClientSecret() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!clientId || !teamId || !keyId || !privateKey) throw new Error('Apple sign-in is not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now, exp: now + 86400 * 30, aud: 'https://appleid.apple.com', sub: clientId })).toString('base64url');
  const input = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(input), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${signature}`;
}
