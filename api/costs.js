// Crowdsourced real student cost data
// Students submit what they actually pay; we serve back the median once
// enough reports exist for a school.
//
// Storage: Vercel KV (free tier). Falls back to in-memory if KV isn't
// configured, so the site never breaks — it just won't persist.

import { kv } from '@vercel/kv';

// ── Config ──
const MIN_REPORTS = 5;          // don't show crowd data below this
const MAX_REPORTS_STORED = 500; // cap per school per field
const SUBMIT_WINDOW = 1000 * 60 * 60 * 24 * 30; // 1 IP per school per 30 days

// Sane ranges — anything outside is rejected outright
const RANGES = {
  housing:   { min: 100,  max: 5000  },
  food:      { min: 50,   max: 2000  },
  transport: { min: 0,    max: 800   },
  tuition:   { min: 500,  max: 150000 }
};

// In-memory fallback + rate limit tracking
const memStore = new Map();
const submitLog = new Map();
let kvAvailable = true;

// ── Helpers ──

function normalizeSchool(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .slice(0, 60);
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function readKey(key) {
  if (kvAvailable) {
    try {
      const v = await kv.get(key);
      if (v) return v;
      return null;
    } catch (e) {
      console.error('KV read failed, using memory:', e.message);
      kvAvailable = false;
    }
  }
  return memStore.get(key) || null;
}

async function writeKey(key, value) {
  if (kvAvailable) {
    try {
      await kv.set(key, value);
      return;
    } catch (e) {
      console.error('KV write failed, using memory:', e.message);
      kvAvailable = false;
    }
  }
  memStore.set(key, value);
}

function canSubmit(ip, school, field) {
  const key = `${ip}|${school}|${field}`;
  const last = submitLog.get(key);
  const now = Date.now();
  if (last && now - last < SUBMIT_WINDOW) return false;
  submitLog.set(key, now);
  return true;
}

// ── Handler ──

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: fetch crowd data for a school ──
  if (req.method === 'GET') {
    try {
      const school = normalizeSchool(req.query.school || '');
      if (!school || school.length < 2) {
        return res.status(400).json({ error: 'School required' });
      }

      const out = {};
      for (const field of Object.keys(RANGES)) {
        const rec = await readKey(`cost:${school}:${field}`);
        if (rec && rec.values && rec.values.length >= MIN_REPORTS) {
          out[field] = {
            median: median(rec.values),
            count: rec.values.length
          };
        }
      }

      return res.status(200).json({ school, data: out });
    } catch (err) {
      console.error('Costs GET error:', err);
      return res.status(500).json({ error: 'Could not load data' });
    }
  }

  // ── POST: submit a report ──
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const school = normalizeSchool(body.school || '');
      const field  = String(body.field || '').trim();
      const amount = Number(body.amount);

      if (!school || school.length < 2) {
        return res.status(400).json({ error: 'School required' });
      }
      if (!RANGES[field]) {
        return res.status(400).json({ error: 'Invalid field' });
      }
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      const { min, max } = RANGES[field];
      if (amount < min || amount > max) {
        return res.status(400).json({ error: `Amount must be between ${min} and ${max}` });
      }

      const ip = req.headers['x-forwarded-for']
        || req.headers['cf-connecting-ip']
        || req.socket?.remoteAddress
        || 'unknown';

      if (!canSubmit(ip, school, field)) {
        return res.status(429).json({ error: 'Already submitted for this school recently' });
      }

      const key = `cost:${school}:${field}`;
      const rec = (await readKey(key)) || { values: [] };

      rec.values.push(Math.round(amount));
      if (rec.values.length > MAX_REPORTS_STORED) {
        rec.values = rec.values.slice(-MAX_REPORTS_STORED);
      }
      rec.updated = Date.now();

      await writeKey(key, rec);

      const enough = rec.values.length >= MIN_REPORTS;
      return res.status(200).json({
        ok: true,
        count: rec.values.length,
        median: enough ? median(rec.values) : null,
        needed: enough ? 0 : MIN_REPORTS - rec.values.length
      });

    } catch (err) {
      console.error('Costs POST error:', err);
      return res.status(500).json({ error: 'Could not save' });
    }
  }

  return res.status(405).end();
}
