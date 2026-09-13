import { checkRateLimit, getClientIp } from './_rate-limit.js';

// Keep this deliberately low: this endpoint sends real email from your domain.
const RATE_LIMIT = 5;
const RATE_WINDOW = 3600000; // 1 hour

// Email validation
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') return res.status(405).end();

  // Rate limiting
  const ip = getClientIp(req);
  if (!(await checkRateLimit({ namespace: 'email', identifier: ip, limit: RATE_LIMIT, windowMs: RATE_WINDOW }))) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let { email, summary } = body;

    // Validate email
    if (!validateEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address' });
    }

    // Validate data
    if (!summary || typeof summary !== 'string') {
      return res.status(400).json({ ok: false, error: 'Results summary required' });
    }

    // Trim and validate lengths
    email = String(email).trim().toLowerCase();
    summary = String(summary).trim().substring(0, 10000);
    const safeSummary = escapeHtml(summary).replace(/\n/g, '<br>');

    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
      console.error('Resend API key not configured');
      return res.status(500).json({ ok: false, error: 'Email service not available' });
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CalculateTuition <hello@calculatetuition.com>',
        to: [email],
        subject: 'Your university cost breakdown — CalculateTuition',
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#2c2825"><h1 style="font-size:22px">Your university cost breakdown</h1><p style="line-height:1.65">${safeSummary}</p><hr style="border:0;border-top:1px solid #e0dcd6"><p style="font-size:12px;color:#777">Planning estimate from CalculateTuition.com. Verify official figures with your school. Not financial advice.</p></div>`,
        text: summary
      })
    });

    const responseData = await emailResponse.json().catch(() => ({}));

    if (emailResponse.ok) {
      return res.status(200).json({ ok: true });
    }

    console.error('Resend error:', responseData);
    return res.status(500).json({ ok: false, error: 'Failed to send email. Please try again.' });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ ok: false, error: 'Error processing request. Please try again.' });
  }
}
