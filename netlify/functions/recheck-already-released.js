const { runRecheckAlreadyReleasedScores } = require('../../lib/discovery/recheckAlreadyReleasedScores');

exports.handler = async function (event) {
  const requestedMax = parseInt(event?.queryStringParameters?.max, 10);
  const maxPerRun = Number.isInteger(requestedMax) && requestedMax >= 0 ? Math.min(requestedMax, 5) : undefined;

  let output;
  try {
    output = await runRecheckAlreadyReleasedScores(maxPerRun !== undefined ? { maxPerRun } : undefined);
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
    if (r.consistent) {
      return `<div class="row dim">${r.originalScore} confirmed consistent, ${r.artist} &mdash; ${r.albumTitle}</div>`;
    }
    const removal = !r.droppedBelowThreshold
      ? ''
      : r.spotifyRemoval.error
      ? ` <span class="err">removal failed: ${r.spotifyRemoval.error}</span>`
      : ` <span class="ok">${r.spotifyRemoval.removedCount} track(s) pulled from playlist</span>`;
    return `<div class="row"><b>${r.originalScore} &rarr; ${r.newScore}</b> ${r.artist} &mdash; ${r.albumTitle}${removal}</div>`;
  };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recheck scores</title>
<style>
body{font-family:ui-monospace,monospace;max-width:760px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
.row{margin-bottom:6px}
.err{color:#f88}
.ok{color:#9fd}
.dim{color:#888}
a{color:#9fd}
</style></head><body>
<h1>Rechecking pre-existing high scorers</h1>
<p><a href="/">&larr; back</a></p>
<p>${output.totalCandidates} already-released entries scored 50+ before the consistency check existed. Processed ${output.processed} this run.</p>
<p>${output.stillQueued} still left, revisit this page to keep going.</p>
${output.results.length ? output.results.map(row).join('\n') : '<p>Nothing to do.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
