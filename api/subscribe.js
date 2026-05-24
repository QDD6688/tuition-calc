export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, summary, htmlBody } = body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
      return res.status(500).json({ ok: false, error: 'Email service not configured' });
    }

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [email],
        subject: 'Your university cost breakdown — CalculateTuition',
        html: htmlBody || `<p>${(summary || 'No results').replace(/\n/g,'<br>')}</p>`,
        text: summary || 'No results available.'
      })
    });

    const responseData = await emailResponse.json().catch(() => ({}));

    if (emailResponse.ok) {
      return res.status(200).json({ ok: true });
    }

    console.error('Resend error:', responseData);
    return res.status(500).json({ ok: false, error: responseData });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
