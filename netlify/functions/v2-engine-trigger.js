exports.handler = async function (event) {
  const siteUrl = process.env.URL || `https://${event?.headers?.host || ''}`;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/v2-engine-background`, { method: 'POST' });
    return { statusCode: 200, body: JSON.stringify({ ok: res.status === 202, acceptedStatus: res.status }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
