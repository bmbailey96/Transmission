const { connectLambda } = require('@netlify/blobs');
const { getAllReleases, upsertRelease } = require('../../lib/storage/releaseStore');
const { jitterScore } = require('../../lib/scoring/scoreRelease');

/**
 * One-time backfill: applies the same deterministic jitter that new scores
 * get at scoring time to everything already sitting in storage from before
 * the jitter existed. Pure math on the existing score, artist, and title,
 * no model call involved.
 *
 * Safe to visit more than once. Each release gets a scoreJitterApplied flag
 * once it's been processed, and anything already flagged is left alone on
 * later runs, so this can't accidentally double-jitter something.
 */
exports.handler = async function (event) {
  connectLambda(event);

  let releases = [];
  try {
    releases = await getAllReleases();
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not load releases: ' + err.message }),
    };
  }

  const changed = [];
  const alreadyDone = [];
  const skippedNoScore = [];

  for (const release of releases) {
    if (release.scoreJitterApplied) {
      alreadyDone.push(release);
      continue;
    }
    if (typeof release.score !== 'number') {
      skippedNoScore.push(release);
      continue;
    }

    const oldScore = release.score;
    const newScore = jitterScore(oldScore, release.artist, release.albumTitle);

    try {
      await upsertRelease({ ...release, score: newScore, scoreJitterApplied: true });
      changed.push({ artist: release.artist, albumTitle: release.albumTitle, oldScore, newScore });
    } catch (err) {
      changed.push({ artist: release.artist, albumTitle: release.albumTitle, oldScore, newScore, saveError: err.message });
    }
  }

  const rows = (list) =>
    list
      .map(
        (r) =>
          `<div class="row">${r.artist} &mdash; ${r.albumTitle}: ${r.oldScore} &rarr; <b>${r.newScore}</b>${
            r.saveError ? ` <span class="err">(save failed: ${r.saveError})</span>` : ''
          }</div>`
      )
      .join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Jitter backfill</title>
<style>
body{font-family:ui-monospace,monospace;max-width:720px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
h2{font-size:.95em;color:#888;margin-top:32px;border-bottom:1px solid #333;padding-bottom:6px}
.row{margin-bottom:4px}
.err{color:#f88}
a{color:#9fd}
</style></head><body>
<h1>Jitter backfill</h1>
<p><a href="/">&larr; back</a></p>
<p>${releases.length} total releases in storage. ${changed.length} updated just now, ${alreadyDone.length} already had the flag from a previous run, ${skippedNoScore.length} had no numeric score to touch.</p>
<h2>Updated this run (${changed.length})</h2>
${changed.length ? rows(changed) : '<p>Nothing left to update, everything already had the flag.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
