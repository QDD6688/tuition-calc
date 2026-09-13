import { checkRateLimit, getClientIp } from './_rate-limit.js';

const RATE_LIMIT = 30; // 30 requests per IP per minute
const RATE_WINDOW = 60000; // 1 minute

// Input validation
function validateInput(body) {
  if (!body || typeof body !== 'object') return 'Invalid request body';

  const { messages, system } = body;

  if (!messages || !Array.isArray(messages)) return 'Messages array required';
  if (messages.length === 0 || messages.length > 10) return 'Invalid message count';

  // Validate each message
  for (const msg of messages) {
    if (!msg.role || !msg.content) return 'Invalid message format';
    if (!/^(user|assistant)$/.test(msg.role)) return 'Invalid role';
    if (typeof msg.content !== 'string') return 'Message content must be string';
    if (msg.content.length > 2000) return 'Message too long';
  }

  if (system !== undefined && (typeof system !== 'string' || system.length > 3000)) {
    return 'Invalid system context';
  }

  return null;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Rate limiting
  const ip = getClientIp(req);
  if (!(await checkRateLimit({ namespace: 'chat', identifier: ip, limit: RATE_LIMIT, windowMs: RATE_WINDOW }))) {
    return res.status(429).json({ error: { message: 'Too many requests. Please wait before trying again.' } });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Validate input
    const validationError = validateInput(body);
    if (validationError) {
      return res.status(400).json({ error: { message: validationError } });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: { message: 'AI advisor is temporarily unavailable' } });
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    };

    const safeBody = {
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: body.messages
    };
    if (body.system) safeBody.system = body.system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(safeBody),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Anthropic chat error:', response.status, data.error?.type || 'unknown');
      return res.status(502).json({ error: { message: 'AI advisor is temporarily unavailable' } });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: { message: 'Error processing request. Please try again.' } });
  }
}
