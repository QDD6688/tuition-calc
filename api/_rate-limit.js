import { createHash } from 'node:crypto';
import { getRedis } from './_redis.js';

const memoryBuckets = new Map();

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
  return firstForwarded.trim()
    || String(req.headers['x-real-ip'] || '').trim()
    || String(req.socket?.remoteAddress || 'unknown');
}

export async function checkRateLimit({ namespace, identifier, limit, windowMs }) {
  const windowId = Math.floor(Date.now() / windowMs);
  const key = `rate:${namespace}:${fingerprint(identifier)}:${windowId}`;
  const redis = getRedis();

  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      return count <= limit;
    } catch (error) {
      console.error('Redis rate limit failed; using local fallback:', error.message);
    }
  }

  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    memoryBuckets.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}
