import { createHash } from 'node:crypto';
import { requireAuth } from './_auth.js';
import { getRedis } from './_redis.js';
import { getClientIp } from './_rate-limit.js';

const MIN_REPORTS = 5;
const MAX_REPORTS_STORED = 500;
const SUBMIT_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

const RANGES = {
  housing: { min: 100, max: 5000 },
  food: { min: 50, max: 2000 },
  transport: { min: 0, max: 800 },
  tuition: { min: 500, max: 150000 }
};

const memoryValues = new Map();
const memorySubmissionLocks = new Map();

function normalizeSchool(name) {
  return String(name)
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .slice(0, 80);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function submissionKey(ip, school, field) {
  const digest = createHash('sha256').update(ip).digest('hex').slice(0, 24);
  return `cost-submit:${digest}:${school}:${field}`;
}

async function readValues(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const values = await redis.lrange(key, 0, -1);
      return values.map(Number).filter(Number.isFinite);
    } catch (error) {
      console.error('Redis read failed; using local fallback:', error.message);
    }
  }
  return memoryValues.get(key) || [];
}

async function appendValue(key, value) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.rpush(key, value);
      await redis.ltrim(key, -MAX_REPORTS_STORED, -1);
      return await readValues(key);
    } catch (error) {
      console.error('Redis write failed; using local fallback:', error.message);
    }
  }

  const values = [...(memoryValues.get(key) || []), value].slice(-MAX_REPORTS_STORED);
  memoryValues.set(key, values);
  return values;
}

async function acquireSubmissionLock(ip, school, field) {
  const key = submissionKey(ip, school, field);
  const redis = getRedis();
  if (redis) {
    try {
      const result = await redis.set(key, '1', { nx: true, px: SUBMIT_WINDOW_MS });
      return { allowed: result === 'OK', key, redis };
    } catch (error) {
      console.error('Redis submission lock failed; using local fallback:', error.message);
    }
  }

  const now = Date.now();
  const expiresAt = memorySubmissionLocks.get(key) || 0;
  if (expiresAt > now) return { allowed: false, key, redis: null };
  memorySubmissionLocks.set(key, now + SUBMIT_WINDOW_MS);
  return { allowed: true, key, redis: null };
}

async function releaseSubmissionLock(lock) {
  if (!lock?.allowed) return;
  if (lock.redis) {
    try {
      await lock.redis.del(lock.key);
      return;
    } catch (error) {
      console.error('Could not release Redis submission lock:', error.message);
    }
  }
  memorySubmissionLocks.delete(lock.key);
}

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      const school = normalizeSchool(req.query.school || '');
      if (school.length < 2) return res.status(400).json({ error: 'School required' });

      const entries = await Promise.all(Object.keys(RANGES).map(async field => {
        const values = await readValues(`cost:${school}:${field}`);
        return [field, values];
      }));

      const data = {};
      for (const [field, values] of entries) {
        if (values.length >= MIN_REPORTS) {
          data[field] = { median: median(values), count: values.length };
        }
      }
      return res.status(200).json({ school, data });
    } catch (error) {
      console.error('Costs GET error:', error);
      return res.status(500).json({ error: 'Could not load data' });
    }
  }

  if (req.method === 'POST') {
    let lock;
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const school = normalizeSchool(body?.school || '');
      const field = String(body?.field || '').trim();
      const amount = Number(body?.amount);

      if (school.length < 2) return res.status(400).json({ error: 'School required' });
      if (!RANGES[field]) return res.status(400).json({ error: 'Invalid field' });
      if (!Number.isFinite(amount)) return res.status(400).json({ error: 'Invalid amount' });

      const { min, max } = RANGES[field];
      if (amount < min || amount > max) {
        return res.status(400).json({ error: `Amount must be between ${min} and ${max}` });
      }

      lock = await acquireSubmissionLock(getClientIp(req), school, field);
      if (!lock.allowed) {
        return res.status(429).json({ error: 'Already submitted for this school recently' });
      }

      const values = await appendValue(`cost:${school}:${field}`, Math.round(amount));
      const enough = values.length >= MIN_REPORTS;
      return res.status(200).json({
        ok: true,
        count: values.length,
        median: enough ? median(values) : null,
        needed: enough ? 0 : MIN_REPORTS - values.length
      });
    } catch (error) {
      await releaseSubmissionLock(lock);
      console.error('Costs POST error:', error);
      return res.status(500).json({ error: 'Could not save' });
    }
  }

}
