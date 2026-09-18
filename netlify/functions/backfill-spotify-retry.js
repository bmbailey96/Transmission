const { connectLambda } = require('@netlify/blobs');
const { getAllReleases, upsertRelease } = require('../../lib/storage/releaseStore');
const { addAlbumToPlaylist } = require('../../lib/spotify/spotifyPlaylist');

const SCORE_THRESHOLD_FOR_PLAYLIST = 75; // backlog only the strongest missed releases
const MAX_PER_RUN = 4; // was 15: a real run at that size tripped Spotify's 429 QUOTA_EXCEEDED after burning through token refreshes with zero delay between albums, see spotifyPlaylist.js's token cache and DELAY_BETWEEN_ALBUMS_MS below
const DELAY_BETWEEN_ALBUMS_MS = 900; // give Spotify's rate limiter room between albums instead of firing search/tracks/playlist calls back to back

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function releaseMoment(r) {
  if (r?.releaseDate) {
    const t = new Date(r.releaseDate + 'T12:00:00Z').getTime();
    if (Number.isFinite(t)) return t;
  }
  for (const value of [r?.alreadyReleasedAt, r?.spotifyLastAttemptAt, r?.updatedAt, r?.discoveredAt]) {
    const t = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * One-time cleanup, not part of the regular pipeline. Found live, Sept
 * 2026: 88 releases already marked already-released, already scoring 50+,
 * dating back to January, were never in the actual Spotify playlist —
 * Broken Social Scene, Sunn O))), American Football, Wendy Eisenberg,
 * Boards of Canada, dozens more. Nobody could tell why, because
 * addAlbumToPlaylist's result was never saved anywhere before this: it
 * only ever existed in the HTTP response of whatever run first scored the
 * album, then was gone. This retries the exact same add-to-playlist step
 * for anything that's missing a confirmed success, and this time the
 * outcome (added / not found on Spotify / a real error) gets written onto
 * the release, so the next time something looks like it's "missing" this
 * page actually says why instead of leaving it a mystery.
 *
 * Safe to run as many times as needed: addAlbumToPlaylist checks the live
 * playlist before adding anything, so a track that's already there gets
 * skipped, never duplicated. Not scheduled on purpose, this is a one-time
 * backlog, not an ongoing job, revisit this page manually until "still
 * left" hits zero, the same pattern as backfill-jitter.js and
 * backfill-announced.js.
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

  const successful = releases
    .filter((r) => r.category === 'already-released' && r.spotifyStatus?.found === true)
    .sort((a, b) => releaseMoment(b) - releaseMoment(a));
  const anchor = successful[0] || null;
  const anchorMoment = anchor
    ? releaseMoment(anchor)
    : Date.now() - 60 * 24 * 60 * 60 * 1000;

  // Catch up only after the last confirmed successful Spotify release.
  // A confirmed found:false is terminal. Missing status and real API errors
  // are retryable, and the strongest missed records go first.
  const candidates = releases
    .filter((r) => {
      const s = r.spotifyStatus;
      const retryable = !s || !s.attempted || !!s.error;
      return (
        r.category === 'already-released' &&
        typeof r.score === 'number' &&
        r.score >= SCORE_THRESHOLD_FOR_PLAYLIST &&
        releaseMoment(r) >= anchorMoment &&
        retryable
      );
    })
    .sort((a, b) => (b.score - a.score) || (releaseMoment(b) - releaseMoment(a)));
  const toProcess = candidates.slice(0, MAX_PER_RUN);

  const results = [];
  for (const release of toProcess) {
    if (results.length > 0) await sleep(DELAY_BETWEEN_ALBUMS_MS);

    let spotify;
    try {
      const spotifyResult = await addAlbumToPlaylist({
        artist: release.artist,
        albumTitle: release.albumTitle,
        standoutTrackNames: release.standoutTracks || [],
      });
      spotify = { attempted: true, ...spotifyResult };
    } catch (err) {
      spotify = { attempted: true, error: err.message };
    }

    try {
      await upsertRelease({
        artist: release.artist,
        albumTitle: release.albumTitle,
        spotifyStatus: spotify,
        spotifyRetryCount: spotify.error ? (release.spotifyRetryCount || 0) + 1 : 0,
        spotifyLastAttemptAt: new Date().toISOString(),
      });
    } catch (err) {
      // best effort, don't let a failed status-save take down the run
    }

    results.push({ artist: release.artist, albumTitle: release.albumTitle, score: release.score, spotify });
  }

  const added = results.filter((r) => r.spotify.found && (r.spotify.tracksAdded || []).length > 0);
  const alreadyThere = results.filter((r) => r.spotify.found && (r.spotify.tracksAdded || []).length === 0);
  const notFound = results.filter((r) => r.spotify.found === false);
  const errored = results.filter((r) => r.spotify.error);

  const row = (r) => {
    const s = r.spotify;
    const note = s.error
      ? `<span class="err">error: ${s.error}</span>`
      : s.found === false
      ? `<span class="dim">not found on Spotify</span>`
      : (s.tracksAdded || []).length
      ? `<span class="ok">added: ${s.tracksAdded.join(', ')}</span>`
      : `<span class="dim">already had its picked tracks</span>`;
    return `<div class="row"><b>${r.score}</b> ${r.artist} &mdash; ${r.albumTitle}: ${note}</div>`;
  };

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Spotify add retry</title>
<style>
body{font-family:ui-monospace,monospace;max-width:760px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
.row{margin-bottom:6px}
.err{color:#f88}
.ok{color:#9fd}
.dim{color:#888}
a{color:#9fd}
</style></head><body>
<h1>Spotify add retry</h1>
<p><a href="/">&larr; back</a></p>
<p>Anchor: ${anchor ? `${anchor.artist} — ${anchor.albumTitle} (${anchor.releaseDate || 'date unknown'})` : 'no confirmed success found; using the last 60 days'}.</p>
<p>${candidates.length} later releases score ${SCORE_THRESHOLD_FOR_PLAYLIST}+ and still need a Spotify attempt. Processed ${toProcess.length} this run: ${added.length} added tracks, ${alreadyThere.length} already had them, ${notFound.length} not found on Spotify, ${errored.length} hit a real error.</p>
<p>${candidates.length - toProcess.length} still left, revisit this page to keep going.</p>
${results.length ? results.map(row).join('\n') : '<p>Nothing to do.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};