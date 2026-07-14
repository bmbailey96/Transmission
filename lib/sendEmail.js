async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM_EMAIL;

  if (!apiKey) throw new Error('RESEND_API_KEY is not set.');
  if (!from) throw new Error('DIGEST_FROM_EMAIL is not set.');
  if (!to) throw new Error('No recipient email set (DIONAEA_TO_EMAIL or DIGEST_TO_EMAIL).');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { sendEmail };
