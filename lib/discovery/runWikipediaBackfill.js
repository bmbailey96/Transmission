const { fetchUpcomingAlbums } = require('./wikipediaAlbumList');
const { getKnownReleaseKeys, releaseKey } = require('../storage/releaseStore');
const { processAlreadyReleasedCandidate } = require('./alreadyReleasedCandidate');

const DEFAULT_MAX_PER_RUN = 1; // same reasoning as the daily mover: a real search-backed scoring call is slow, one at a time keeps every visit safely inside the timeout

/**
 * Wikipedia's running year list is comprehensive but unfiltered by date, this
 * pulls out only entries already in the past that have never been scored at
 * all, neither as an upcoming release nor as an already-released one. Sorted
 * chronologically so repeated visits march through in a stable, predictable order.
 */
async function findBacklogCandidates(year, todayStr) {
  const entries = await fetchUpcomingAlbums(year);
  const knownKeys = await getKnownReleaseKeys();
  const candidates = entries.filter(
    (e) => e.releaseDate && e.releaseDate < todayStr && !knownKeys.has(releaseKey(e.artist, e.albumTitle))
  );
  return candidates.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
}

/**
 * Processes up to maxPerRun backlog entries through the same scoring/storage/
 * Spotify pipeline as the daily mover. Each one saved here is brand new to
 * storage, never having existed as an upcoming entry at all.
 */
async function runWikipediaBackfill({ maxPerRun = DEFAULT_MAX_PER_RUN, now = new Date(), year } = {}) {
  const todayStr = now.toISOString().slice(0, 10);
  const targetYear = year || now.getFullYear();
  const candidates = await findBacklogCandidates(targetYear, todayStr);
  const toProcess = candidates.slice(0, maxPerRun);

  const results = [];
  for (const release of toProcess) {
    results.push(await processAlreadyReleasedCandidate(release, now));
  }

  return {
    totalCandidates: candidates.length,
    processed: results.length,
    stillQueued: candidates.length - results.length,
    results,
  };
}

module.exports = { runWikipediaBackfill, findBacklogCandidates, DEFAULT_MAX_PER_RUN };
