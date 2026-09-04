const { fetchUpcomingAlbums } = require('./wikipediaAlbumList');
const { getKnownReleaseKeys, releaseKey } = require('../storage/releaseStore');
const { processAlreadyReleasedCandidate } = require('./alreadyReleasedCandidate');
const { isValidReleaseDate } = require('../dates/isValidReleaseDate');

const DEFAULT_MAX_PER_RUN = 1; // successful moves to actually land per run, see MAX_ATTEMPTS_PER_RUN
const MAX_ATTEMPTS_PER_RUN = 4; // total candidates to try per run, success or fail

/**
 * Wikipedia's running year list is comprehensive but unfiltered by date, this
 * pulls out only entries already in the past that have never been scored at
 * all, neither as an upcoming release nor as an already-released one. Sorted
 * chronologically so repeated visits march through in a stable, predictable order.
 *
 * releaseDate <= todayStr (not <), same reasoning as the daily mover: a
 * same-day release shouldn't sit as "upcoming" for one extra day.
 * isValidReleaseDate is a defensive check, wikipediaAlbumList.js always
 * builds a full date, but this is the same comparison bug that hit the RSS
 * side, worth guarding here too rather than assuming it can't happen.
 */
async function findBacklogCandidates(year, todayStr) {
  const entries = await fetchUpcomingAlbums(year);
  const knownKeys = await getKnownReleaseKeys();
  const candidates = entries.filter(
    (e) =>
      e.releaseDate &&
      isValidReleaseDate(e.releaseDate) &&
      e.releaseDate <= todayStr &&
      !knownKeys.has(releaseKey(e.artist, e.albumTitle))
  );
  return candidates.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
}

/**
 * Processes backlog entries through the same scoring/storage/Spotify
 * pipeline as the daily mover. Each one saved here is brand new to storage,
 * never having existed as an upcoming entry at all.
 *
 * Previously this only ever tried exactly maxPerRun candidates
 * (candidates.slice(0, maxPerRun), maxPerRun defaulting to 1), with no way
 * to get past one that failed: processAlreadyReleasedCandidate already
 * catches its own errors and returns an {error} result rather than
 * throwing, but with maxPerRun=1 that just meant the same first candidate
 * got retried, alone, every single run, and nothing behind it in the
 * backlog ever got a turn. This now tries up to maxAttempts candidates per
 * run and keeps going past failures, so a bad one can't block the whole
 * backlog the way it could before.
 */
async function runWikipediaBackfill({
  maxPerRun = DEFAULT_MAX_PER_RUN,
  maxAttempts = MAX_ATTEMPTS_PER_RUN,
  now = new Date(),
  year,
} = {}) {
  const todayStr = now.toISOString().slice(0, 10);
  const targetYear = year || now.getFullYear();
  const candidates = await findBacklogCandidates(targetYear, todayStr);

  const results = [];
  let succeeded = 0;
  let attempted = 0;

  for (const release of candidates) {
    if (succeeded >= maxPerRun || attempted >= maxAttempts) break;
    attempted++;
    const result = await processAlreadyReleasedCandidate(release, now);
    results.push(result);
    if (!result.error) succeeded++;
  }

  return {
    totalCandidates: candidates.length,
    processed: results.length,
    succeeded,
    stillQueued: candidates.length - succeeded,
    results,
  };
}

module.exports = { runWikipediaBackfill, findBacklogCandidates, DEFAULT_MAX_PER_RUN, MAX_ATTEMPTS_PER_RUN };
