export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, summary } = body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }

    // Send results email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CalculateTuition <results@calculatetuition.com>',
        to: [email],
        subject: 'Your university cost breakdown — CalculateTuition',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#2C2825;">
            <h1 style="font-size:24px;margin-bottom:8px;color:#2C2825;">Your university cost breakdown</h1>
            <p style="color:#8C8480;margin-bottom:24px;font-size:14px;">From <a href="https://calculatetuition.com" style="color:#E8633A;">calculatetuition.com</a></p>
            <div style="background:#F7F5F2;border-radius:12px;padding:24px;margin-bottom:24px;">
              <pre style="font-family:monospace;font-size:14px;line-height:1.8;white-space:pre-wrap;color:#2C2825;margin:0;">${summary || 'No results data available.'}</pre>
            </div>
            <p style="font-size:13px;color:#8C8480;line-height:1.6;">These are estimates for planning purposes only. For official numbers, contact your school's financial aid office. Not financial advice.</p>
            <hr style="border:none;border-top:1px solid #E0DCD6;margin:24px 0;"/>
            <p style="font-size:12px;color:#B0ABA6;">You're receiving this because you requested your results on calculatetuition.com. <a href="https://calculatetuition.com" style="color:#E8633A;">Visit site</a></p>
          </div>
        `
      })
    });

    if (emailResponse.ok) {
      // Also add to Buttondown if key exists
      if (process.env.BUTTONDOWN_API_KEY) {
        await fetch('https://api.buttondown.email/v1/subscribers', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email, tags: ['calculatetuition'] })
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true });
    }

    const errData = await emailResponse.json().catch(() => ({}));
    console.error('Resend error:', errData);
    return res.status(500).json({ ok: false, error: errData });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
