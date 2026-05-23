export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, summary } = body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }

    const response = await fetch('https://api.buttondown.email/v1/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        notes: summary || '',
        tags: ['calculatetuition']
      })
    });

    const data = await response.json().catch(() => ({}));

    // 201 = created, 200 = ok, 400 with "already subscribed" is also fine
    if (response.ok || (data.code && data.code === 'subscriber_already_exists')) {
      return res.status(200).json({ ok: true });
    }

    return res.status(response.status).json({ ok: false, error: data });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
