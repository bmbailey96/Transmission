/**
 * Receives the redirect from Spotify's OAuth consent screen and displays
 * the resulting authorization code (or error) in plain text so it can be
 * copied by hand. This is a one-time setup tool, not part of the ongoing
 * app, used to mint the refresh token that the real playlist-write code
 * will run on indefinitely afterward.
 */
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const error = params.error;

  let body;
  if (code) {
    body = `
<h1>Authorization code received</h1>
<p>Copy this whole value, it's only good for a couple of minutes:</p>
<div class="code">${code}</div>
`;
  } else if (error) {
    body = `
<h1>Spotify returned an error</h1>
<div class="code">${error}</div>
<p>Most likely the consent screen was denied, or the redirect URI here doesn't exactly match what's registered in the app's dashboard settings.</p>
`;
  } else {
    body = `
<h1>No code or error in this request</h1>
<p>This page is only meaningful when Spotify redirects here after a login. Visiting it directly does nothing.</p>
`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Spotify callback</title>
<style>
body{font-family:ui-monospace,monospace;max-width:640px;margin:60px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.1em;color:#9fd}
.code{background:#1a1a1a;border:1px solid #333;padding:14px;margin:14px 0;word-break:break-all;color:#fd9;font-size:0.95em}
</style></head><body>${body}</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
