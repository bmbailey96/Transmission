exports.handler = async function (event) {
  const siteUrl = process.env.URL || `https://${event?.headers?.host || ''}`;
  const backgroundUrl = `${siteUrl}/.netlify/functions/wikipedia-backlog-background`;

  const page = (body) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Wikipedia backlog trigger</title>
<style>
body{font-family:ui-monospace,monospace;max-width:600px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
a{color:#9fd}
.err{color:#f88}
</style></head><body>${body}</body></html>`,
  });

  let res;
  try {
    res = await fetch(backgroundUrl, { method: 'POST' });
  } catch (err) {
    return page(`<h1 class="err">Couldn't trigger it</h1><p>${err.message}</p><p><a href="/">&larr; back</a></p>`);
  }

  if (res.status !== 202) {
    return page(`<h1 class="err">Unexpected response</h1><p>Got status ${res.status} instead of the 202 a background function should return when it's accepted.</p><p><a href="/">&larr; back</a></p>`);
  }

  return page(`<h1>Triggered</h1>
<p>A batch of the Wikipedia backlog is now running in the background. This will take several minutes, and nothing will appear here while it works, that's expected.</p>
<p>Check progress at the <a href="/.netlify/functions/wikipedia-backlog?max=0">backlog page</a> in a few minutes. Come back here and tap again whenever you want to run another batch.</p>
<p><a href="/">&larr; back</a></p>`);
};
