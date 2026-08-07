// Simple in-memory cache — resets on each deployment but saves money on repeated lookups
// within the same server instance lifetime
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { school, program, studentType } = body;

    if (!school) return res.status(400).json({ error: 'School required' });

    // Build cache key
    const cacheKey = `${school.toLowerCase().trim()}|${(program||'').toLowerCase().trim()}|${studentType||'domestic'}`;

    // Return cached result if fresh
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Cache hit:', cacheKey);
      return res.status(200).json({ ...cached.data, cached: true });
    }

    const currentYear = new Date().getFullYear();
    const prog = program || 'general undergraduate';
    const isIntl = studentType === 'international';

    let prompt;
    if (isIntl) {
      prompt = 'Find for ' + school + ' ' + prog + ' international student ' + currentYear + ': annual international tuition CAD, international fee premium/yr, monthly rent in city, monthly food, monthly transport, median grad starting salary CAD. Convert USD to CAD at 1.36. Keep response under 100 words then output EXACTLY on last line:\nDATA:name=' + school + '|tuition=TUITION|intlfee=INTLFEE|housing=HOUSING|food=FOOD|transport=TRANSPORT|salary=SALARY\nIntegers only no symbols.';
    } else {
      prompt = 'Find for ' + school + ' ' + prog + ' domestic student ' + currentYear + ': annual domestic tuition CAD, monthly rent in city, monthly food, monthly transport, median grad starting salary CAD. Convert USD to CAD at 1.36. Keep response under 100 words then output EXACTLY on last line:\nDATA:name=' + school + '|tuition=TUITION|intlfee=0|housing=HOUSING|food=FOOD|transport=TRANSPORT|salary=SALARY\nIntegers only no symbols.';
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

    const data = await response.json();

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
    return res.status(500).json({ error: err.message });
  }
}
