const { getState, allReleases } = require('../../lib/v2/store');

exports.handler = async function () {
  try {
    const state = await getState();
    const releases = allReleases(state).sort((a,b) => {
      if (a.lifecycle !== b.lifecycle) return a.lifecycle === 'upcoming' ? -1 : 1;
      if (a.lifecycle === 'upcoming') return (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999');
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        version: 2,
        releases,
        lastRun: state.lastRun,
        recentEvents: (state.events || []).slice(-12).reverse(),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
