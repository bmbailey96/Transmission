exports.handler = async function (event) {
  const siteUrl = process.env.URL || `https://${event?.headers?.host || ''}`;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/v2-spotify-backlog-background`, {
      method: 'POST',
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        ok: res.status === 202,
        acceptedStatus: res.status,
        message: 'V2 Spotify backlog batch accepted',
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
