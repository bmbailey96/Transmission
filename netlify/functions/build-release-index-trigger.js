exports.handler = async function (event) {
  const siteUrl = process.env.URL || `https://${event?.headers?.host || ''}`;
  const backgroundUrl = `${siteUrl}/.netlify/functions/build-release-index-background`;

  const page = (body) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Build release index</title>
<style>
body{font-family:ui-monospace,monospace;max-width:640px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
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

  return page(`<h1>Building the release index</h1>
<p>This is a one-time migration: it reads every release currently stored the old way (one blob per release) and writes them all into a single index blob, which is what the site now reads from. It only needs to run once. Running it again later is harmless, it just rebuilds the same index from the same source blobs.</p>
<p>This runs in the background and can take a little while if the store is large. Nothing will appear here while it works, that's expected.</p>
<p>Once it's done, the front page and <a href="/.netlify/functions/test-discovery">the discovery test page</a> should load again. Give it a minute or two, then reload either one.</p>
<p><a href="/">&larr; back</a></p>`);
};