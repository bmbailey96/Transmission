const { connectLambda } = require('@netlify/blobs');
const { getState, saveState, allReleases } = require('../../lib/v2/store');
const { syncSpotify, SCORE_FOR_SPOTIFY } = require('../../lib/v2/engine');

const MAX_PER_RUN = 2;
const DELAY_BETWEEN_ALBUMS_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async function (event) {
  connectLambda(event);

  try {
    const state = await getState();
    // Retire stale pending/error records that no longer clear the stricter
    // playlist bar, so they cannot consume manual or scheduled retry slots.
    for (const r of allReleases(state)) {
      if (
        r.lifecycle === 'released' &&
        typeof r.score === 'number' &&
        r.score < SCORE_FOR_SPOTIFY &&
        (r.spotify?.status === 'pending' || r.spotify?.status === 'error')
      ) {
        r.spotify = { status: 'not_needed', attempts: r.spotify?.attempts || 0 };
      }
    }

    const candidates = allReleases(state)
      .filter(r =>
        r.lifecycle === 'released' &&
        typeof r.score === 'number' &&
        r.score >= SCORE_FOR_SPOTIFY &&
        (r.spotify?.status === 'pending' || r.spotify?.status === 'error') &&
        (r.spotify?.attempts || 0) < 5 &&
        (
          r.spotify?.status === 'pending' ||
          !r.spotify.nextRetryAt ||
          new Date(r.spotify.nextRetryAt).getTime() <= now
        )
      )
      .sort((a, b) =>
        (b.score - a.score) ||
        String(b.releaseDate || '').localeCompare(String(a.releaseDate || ''))
      );

    const batch = candidates.slice(0, MAX_PER_RUN);
    const results = [];

    for (const release of batch) {
      if (results.length > 0) await sleep(DELAY_BETWEEN_ALBUMS_MS);
      await syncSpotify(release, state);
      await saveState(state);
      results.push({
        artist: release.artist,
        albumTitle: release.albumTitle,
        score: release.score,
        spotify: release.spotify,
      });
    }

    await saveState(state);

    console.log('V2 Spotify backlog batch:', JSON.stringify({
      ok: true,
      threshold: SCORE_FOR_SPOTIFY,
      candidatesBeforeRun: candidates.length,
      processed: results.length,
      remaining: Math.max(0, candidates.length - results.length),
      results,
    }));
    return { statusCode: 200 };
  } catch (err) {
    console.error('V2 Spotify backlog failed:', err);
    return { statusCode: 200 };
  }
};
