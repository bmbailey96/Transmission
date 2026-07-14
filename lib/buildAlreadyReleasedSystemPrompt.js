/**
 * Thin wrapper around the Resend API. Kept deliberately dumb — one function,
 * one job — so swapping providers later (if Resend ever stops fitting) means
 * touching this file only, not every function that sends mail.
 */
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM_EMAIL;

  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY is not set. Add it to your .env locally, or to Netlify environment variables in production.'
    );
  }
  if (!from) {
    throw new Error(
      'DIGEST_FROM_EMAIL is not set. Add it to your .env locally, or to Netlify environment variables in production.'
    );
  }
  if (!to) {
    throw new Error('DIGEST_TO_EMAIL is not set.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }

  return res.json();
}

module.exports = { sendEmail };
