export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, summary } = body;

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
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#2C2825;background:#ffffff;">
            <div style="margin-bottom:24px;">
              <span style="font-size:20px;font-weight:700;color:#2C2825;">tuition</span><span style="font-size:20px;font-weight:700;color:#E8633A;">calculator</span>
            </div>
            <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;color:#2C2825;">Your university cost breakdown</h1>
            <p style="color:#8C8480;margin-bottom:24px;font-size:14px;">From <a href="https://calculatetuition.com" style="color:#E8633A;text-decoration:none;">calculatetuition.com</a></p>

            <div style="background:#F7F5F2;border-radius:12px;padding:24px;margin-bottom:24px;">
              <pre style="font-family:monospace;font-size:13px;line-height:1.9;white-space:pre-wrap;color:#2C2825;margin:0;">${(summary || 'No results available.').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
            </div>

            <div style="background:#FDF2EE;border-radius:10px;padding:16px;margin-bottom:24px;">
              <p style="font-size:13px;color:#C44A22;margin:0;line-height:1.6;">💡 <strong>Tip:</strong> These numbers are estimates. Always verify tuition directly with your school's registrar and check your province's student aid program for the most accurate figures.</p>
            </div>

            <p style="font-size:12px;color:#B0ABA6;line-height:1.6;">These are estimates for planning purposes only. Not financial advice. This tool is intended for users aged 13 and older.</p>
            <hr style="border:none;border-top:1px solid #E0DCD6;margin:20px 0;"/>
            <p style="font-size:11px;color:#B0ABA6;">You requested this breakdown on <a href="https://calculatetuition.com" style="color:#E8633A;">calculatetuition.com</a>. You will not receive further emails unless you sign up for updates.</p>
          </div>
        `
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
