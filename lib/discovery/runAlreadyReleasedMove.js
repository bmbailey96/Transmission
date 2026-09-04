const { getAllReleases, upsertRelease } = require('../storage/releaseStore');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');
const { isValidReleaseDate } = require('../dates/isValidReleaseDate');

const SCORE_THRESHOLD_FOR_PLAYLIST = 50; // same bar the rest of the app already uses for "worth surfacing"
const DEFAULT_MAX_PER_RUN = 1; // successful moves to actually land per run; one real search-backed scoring call plus a Spotify write is already slow, this is the throughput target, not an attempt cap (see MAX_ATTEMPTS_PER_RUN)
const MAX_ATTEMPTS_PER_RUN = 4; // total candidates to try per run, success or fail

// Found live, Sept 2026: this used to be a plain slice(0, maxPerRun) with no
// sort and no way to get past a candidate that kept failing. Real incident:
// the mover successfully moved "Ada Lea - the end is a wave" at 2026-08-13
// 00:00 UTC, then processed nothing else for three straight weeks, one
// hourly run after another, because the very next candidate in storage
// order (Ceremony - Tell Me Your Dream) never got past whatever was wrong
// with it, and with maxPerRun=1 that was the ONLY candidate each run ever
// looked at. Everything released after Aug 13 sat behind it untouched.
// QUARANTINE_AFTER_FAILURES stops a single bad candidate from camping the
// front of the queue forever: after this many consecutive failures it's set
// aside (not retried automatically) so the run moves on to real candidates
// instead. It stays visible via moveFailureCount/lastMoveError on the
// release itself, nothing is silently dropped.
const QUARANTINE_AFTER_FAILURES = 3;

/**
 * Finds releases sitting in storage whose release date has already passed
 * but haven't been moved into the already-released category yet. Anything
 * already marked stays untouched, that's the idempotency guarantee, this
 * can be re-run as often as needed without re-processing or double-adding
 * to the playlist.
 *
 * Sorted oldest-release-first (deterministic, and the sensible order to
 * clear a backlog in) rather than left in whatever order storage happens to
 * return them, which is what let one stuck candidate block everything
 * behind it indefinitely.
 *
 * releaseDate <= todayStr, not <, so a same-day release doesn't sit as
 * "upcoming" for one extra day for no reason.
 *
 * isValidReleaseDate excludes anything that isn't a real full YYYY-MM-DD
 * date. A malformed date (e.g. "2026-09", month-only) can otherwise compare
 * as "already passed" under plain string comparison well before that's
 * actually true, see isValidReleaseDate.js.
 */
function findCandidatesToMove(allReleases, todayStr) {
  return allReleases
    .filter(
      (r) =>
        r.releaseDate &&
        isValidReleaseDate(r.releaseDate) &&
        r.releaseDate <= todayStr &&
        r.category !== 'already-released' &&
        (r.moveFailureCount || 0) < QUARANTINE_AFTER_FAILURES
    )
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
}

/**
 * Moves eligible releases: re-scores each with real search evidence, saves
 * the result over the stale announcement-era score, and adds a Spotify
 * sample only for whatever clears the threshold. A release that doesn't
 * exist on Spotify is recorded as such, not treated as an error.
 *
 * Tries up to maxAttempts candidates (not just maxPerRun) so a failure
 * doesn't stall the whole run: it keeps going until either maxPerRun
 * successful moves land, or maxAttempts candidates have been tried, or the
 * candidate list runs out. A candidate that fails gets its failure recorded
 * on the release itself (moveFailureCount, lastMoveError) rather than
 * silently retried forever; after QUARANTINE_AFTER_FAILURES it drops out of
 * findCandidatesToMove until that's cleared by hand or it starts succeeding.
 */
async function runAlreadyReleasedMove({
  maxPerRun = DEFAULT_MAX_PER_RUN,
  maxAttempts = MAX_ATTEMPTS_PER_RUN,
  now = new Date(),
} = {}) {
  const todayStr = now.toISOString().slice(0, 10);

  let allReleases;
  try {
    allReleases = await getAllReleases();
  } catch (err) {
    // Previously unguarded: a failed read here threw all the way out of
    // this function. The scheduled function's own try/catch still caught
    // that and logged it, so it wasn't literally silent, but this gives a
    // clean, structured result instead of an uncaught exception either way.
    return {
      totalCandidates: 0,
      processed: 0,
      succeeded: 0,
      stillQueued: 0,
      results: [],
      fatalError: `Could not load releases: ${err.message}`,
    };
  }

  const candidates = findCandidatesToMove(allReleases, todayStr);
  const results = [];
  let succeeded = 0;
  let attempted = 0;

  for (const release of candidates) {
    if (succeeded >= maxPerRun || attempted >= maxAttempts) break;
    attempted++;

    let scored;
    try {
      scored = await scoreAlreadyReleased({
        artist: release.artist,
        title: release.albumTitle,
        releaseDate: release.releaseDate,
      });
    } catch (err) {
      const failureCount = (release.moveFailureCount || 0) + 1;
      try {
        await upsertRelease({
          artist: release.artist,
          albumTitle: release.albumTitle,
          moveFailureCount: failureCount,
          lastMoveError: err.message,
          lastMoveAttemptAt: now.toISOString(),
        });
      } catch (saveErr) {
        // Best effort, don't let a failed failure-log take down the run.
      }
      results.push({
        artist: release.artist,
        albumTitle: release.albumTitle,
        error: `scoring failed: ${err.message}`,
        failureCount,
        quarantined: failureCount >= QUARANTINE_AFTER_FAILURES,
      });
      continue;
    }

    let spotify = { attempted: false };
    if (typeof scored.score === 'number' && scored.score >= SCORE_THRESHOLD_FOR_PLAYLIST) {
      try {
        const spotifyResult = await addAlbumToPlaylist({
          artist: release.artist,
          albumTitle: release.albumTitle,
          standoutTrackNames: scored.standoutTracks || [],
        });
        spotify = { attempted: true, ...spotifyResult };
      } catch (err) {
        spotify = { attempted: true, error: err.message };
      }
    }

    // spotifyStatus is persisted here (it never used to be saved at all,
    // only returned in the function's ephemeral HTTP response) so a
    // Spotify-side failure on an otherwise successfully-scored album is
    // visible later via /releases instead of vanishing the moment this
    // invocation ends. That's specifically for cases like Broken Social
    // Scene / Sunn O))) / American Football: all three scored well above
    // the threshold and got marked already-released back on June 18, but
    // never showed up in the actual playlist, and there was no record
    // anywhere of what addAlbumToPlaylist actually returned for them.
    try {
      await upsertRelease({
        artist: release.artist,
        albumTitle: release.albumTitle,
        category: 'already-released',
        score: scored.score,
        headline: scored.headline,
        reasoning: scored.reasoning,
        evidenceLevel: scored.evidenceLevel,
        standoutTracks: scored.standoutTracks,
        alreadyReleasedAt: now.toISOString(),
        spotifyStatus: spotify,
        moveFailureCount: 0,
        lastMoveError: null,
      });
    } catch (err) {
      results.push({
        artist: release.artist,
        albumTitle: release.albumTitle,
        error: `save failed after scoring: ${err.message}`,
      });
      continue;
    }

    succeeded++;
    results.push({
      artist: release.artist,
      albumTitle: release.albumTitle,
      score: scored.score,
      evidenceLevel: scored.evidenceLevel,
      spotify,
    });
  }

  return {
    totalCandidates: candidates.length,
    processed: results.length,
    succeeded,
    stillQueued: candidates.length - succeeded,
    results,
  };
}

module.exports = {
  runAlreadyReleasedMove,
  findCandidatesToMove,
  SCORE_THRESHOLD_FOR_PLAYLIST,
  DEFAULT_MAX_PER_RUN,
  MAX_ATTEMPTS_PER_RUN,
  QUARANTINE_AFTER_FAILURES,
};
