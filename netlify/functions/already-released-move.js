const { runAlreadyReleasedMove } = require('../../lib/discovery/runAlreadyReleasedMove');

exports.handler = async function () {
  let output;
  try {
    output = await runAlreadyReleasedMove();
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html><body style="font-family:monospace;background:#111;color:#f88;padding:30px;">Run failed entirely: ${err.message}</body></html>`,
    };
  }

  const row = (r) => {
    if (r.error) {
      return `<div class="row err">${r.artist} &mdash; ${r.albumTitle}: ${r.error}</div>`;
    }
    const spotifyNote = !r.spotify.attempted
      ? `<span class="dim">below 50, no Spotify attempt</span>`
      : r.spotify.error
      ? `<span class="err">Spotify error: ${r.spotify.error}</span>`
      : r.spotify.found === false
      ? `<span class="dim">not found on Spotify</span>`
      : `<span class="ok">added: ${(r.spotify.tracksAdded || []).join(', ') || '(none new)'}</span>`;
    return `<div class="row"><b>${r.score}</b> ${r.artist} &mdash; ${r.albumTitle} [${r.evidenceLevel}] ${spotifyNote}</div>`;
  };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Already-released move</title>
<style>
body{font-family:ui-monospace,monospace;max-width:760px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
.row{margin-bottom:6px}
.err{color:#f88}
.ok{color:#9fd}
.dim{color:#888}
a{color:#9fd}
</style></head><body>
<h1>Already-released move</h1>
<p><a href="/">&larr; back</a></p>
<p>${output.totalCandidates} releases have a release date in the past and haven't been moved yet. Processed ${output.processed} this run.</p>
<p>${output.stillQueued} still left, revisit this page to keep going.</p>
${output.results.length ? output.results.map(row).join('\n') : '<p>Nothing to do.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
