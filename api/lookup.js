import { checkRateLimit, getClientIp } from './_rate-limit.js';

// Simple in-memory cache — resets on each deployment but saves money on repeated lookups
// within the same server instance lifetime
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

const RATE_LIMIT = 10;
const RATE_WINDOW = 60000; // 1 minute

// Input validation
function validateInput(school, program, studentType) {
  if (!school || typeof school !== 'string') return 'School required';
  if (school.trim().length < 2) return 'School name must be at least 2 characters';
  if (school.trim().length > 100) return 'School name too long';

  if (program && typeof program !== 'string') return 'Invalid program';
  if (program && program.trim().length > 100) return 'Program name too long';

  if (!['domestic', 'international'].includes(studentType)) return 'Invalid student type';

  // Block common injection patterns
  if (/[<>'"]/g.test(school) || /[<>'"]/g.test(program || '')) return 'Invalid characters in input';

  return null;
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } }
};

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Rate limiting
  const ip = getClientIp(req);
  if (!(await checkRateLimit({ namespace: 'lookup', identifier: ip, limit: RATE_LIMIT, windowMs: RATE_WINDOW }))) {
    return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let { school, program, studentType, lang } = body;

    // Trim and validate inputs
    school = school ? String(school).trim() : '';
    program = program ? String(program).trim() : '';
    studentType = String(studentType || 'domestic').trim();
    lang = String(lang || 'en').trim();

    // Validate
    const validationError = validateInput(school, program, studentType);
    if (validationError) return res.status(400).json({ error: validationError });

    // Validate language code (prevent injection)
    if (!/^[a-z]{2}$/.test(lang)) lang = 'en';

    // Build cache key
    const cacheKey = `${school.toLowerCase()}|${(program||'').toLowerCase()}|${studentType}`;

    // Return cached result if fresh
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Cache hit:', cacheKey);
      return res.status(200).json({ ...cached.data, cached: true });
    }

    const currentYear = new Date().getFullYear();
    const prog = program || 'general undergraduate';
    const isIntl = studentType === 'international';

    // Language instruction for response
    const langNames = {
      en: 'English', fr: 'French', zh: 'Chinese (Simplified)', es: 'Spanish',
      hi: 'Hindi', ar: 'Arabic', pt: 'Portuguese', ko: 'Korean', ja: 'Japanese', de: 'German'
    };
    const responseLang = langNames[lang] || 'English';
    const langInstr = lang && lang !== 'en' ? ` Respond in ${responseLang}.` : '';

    let prompt;
    if (isIntl) {
      prompt = 'Find for ' + school + ' ' + prog + ' international student ' + currentYear + ': annual DOMESTIC tuition CAD, the ADDITIONAL annual international-student premium above domestic tuition, monthly rent in city, monthly food, monthly transport, median grad starting salary CAD. The two tuition values must add up to the estimated total international tuition. Convert USD to CAD at 1.36. Keep response under 100 words.' + langInstr + ' Then output EXACTLY on last line:\nDATA:name=' + school + '|tuition=DOMESTIC_TUITION|intlfee=ADDITIONAL_INTL_PREMIUM|housing=HOUSING|food=FOOD|transport=TRANSPORT|salary=SALARY\nIntegers only no symbols.';
    } else {
      prompt = 'Find for ' + school + ' ' + prog + ' domestic student ' + currentYear + ': annual domestic tuition CAD, monthly rent in city, monthly food, monthly transport, median grad starting salary CAD. Convert USD to CAD at 1.36. Keep response under 100 words.' + langInstr + ' Then output EXACTLY on last line:\nDATA:name=' + school + '|tuition=TUITION|intlfee=0|housing=HOUSING|food=FOOD|transport=TRANSPORT|salary=SALARY\nIntegers only no symbols.';
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI lookup is temporarily unavailable' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('Anthropic lookup error:', response.status, data.error?.type || 'unknown');
      return res.status(502).json({ error: 'AI lookup is temporarily unavailable' });
    }

    let text = '';
    if (data.content) {
      text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
    }

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const result = { text, timestamp: Date.now() };

    // Cache the result
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return res.status(200).json(result);

  } catch (err) {
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Error processing request. Please try again.' });
  }
}
