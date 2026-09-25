const { connectLambda } = require('@netlify/blobs');
const { getState, allReleases } = require('../../lib/v2/store');
const curated = require('../../data/curated2026');

function canonicalize(releases) {
  const byKey = new Map();
  for (const item of releases) {
    const r = { ...item };
    if (r.artist === 'Russian Circles' && r.albumTitle === 'LP9') r.albumTitle = 'Nine';
    if (r.artist === 'Lily Seabird' && r.albumTitle === 'Lightspheres on the Way') r.albumTitle = 'Lightspheres on Their Way';
    const key = `${r.artist.toLowerCase()}|${r.albumTitle.toLowerCase()}`;
    const prior = byKey.get(key);
    // A Spotify-synced record keeps its true sync state when duplicate labels merge.
    if (!prior || (r.spotify?.status === 'added' && prior.spotify?.status !== 'added')) byKey.set(key, r);
  }
  return [...byKey.values()];
}

exports.handler = async function (event) {
  connectLambda(event);
  try {
    const state = await getState();
    const releases = canonicalize(allReleases(state)).sort((a,b) => {
      if (a.lifecycle !== b.lifecycle) return a.lifecycle === 'upcoming' ? -1 : 1;
      if (a.lifecycle === 'upcoming') return (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999');
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        version: 2,
        curated,
        releases,
        lastRun: state.lastRun,
        recentEvents: (state.events || []).slice(-12).reverse(),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};

exports.canonicalize = canonicalize;
