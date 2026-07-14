const { getAllReleases, upsertRelease } = require('../storage/releaseStore');
const { scoreRelease } = require('../scoring/scoreRelease');

const DEFAULT_MAX_PER_RUN = 1; // a plain (non-search) scoring call, same cost class as the original discovery scoring itself

/**
 * Upcoming candidates never get a category field at all (only already-released
 * entries do), and rescoredWithHistoryAt marks one as done once it's been run
 * through this, which keeps repeat visits idempotent the same way the other
 * one-time backfills are.
 */
function findUnrescoredUpcoming(allReleases) {
  return allReleases.filter((r) => !r.category && !r.rescoredWithHistoryAt);
}

async function rescoreOneRelease(release, now) {
  let scored;
  try {
    scored = await scoreRelease({
      artist: release.artist,
      title: release.albumTitle,
      evidenceText: release.evidenceText,
    });
  } catch (err) {
    return { artist: release.artist, albumTitle: release.albumTitle, error: `rescoring failed: ${err.message}` };
  }

  await upsertRelease({
    artist: release.artist,
    albumTitle: release.albumTitle,
    score: scored.score,
    headline: scored.headline,
    reasoning: scored.reasoning,
    evidenceLevel: scored.evidenceLevel,
    rescoredWithHistoryAt: now.toISOString(),
  });

  return {
    artist: release.artist,
    albumTitle: release.albumTitle,
    originalScore: release.score,
    newScore: scored.score,
  };
}

async function runRescoreUpcoming({ maxPerRun = DEFAULT_MAX_PER_RUN, now = new Date() } = {}) {
  const allReleases = await getAllReleases();
  const candidates = findUnrescoredUpcoming(allReleases);
  const toProcess = candidates.slice(0, maxPerRun);

  const results = [];
  for (const release of toProcess) {
    results.push(await rescoreOneRelease(release, now));
  }

  return {
    totalCandidates: candidates.length,
    processed: results.length,
    stillQueued: candidates.length - results.length,
    results,
  };
}

module.exports = { runRescoreUpcoming, findUnrescoredUpcoming, DEFAULT_MAX_PER_RUN };
