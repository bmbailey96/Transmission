const { getAllReleases, upsertRelease } = require('../storage/releaseStore');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');

const SCORE_THRESHOLD_FOR_PLAYLIST = 50; // same bar the rest of the app already uses for "worth surfacing"
const DEFAULT_MAX_PER_RUN = 1; // one real search-backed scoring call plus a Spotify write is already slow; 10 of these in one synchronous function is what was timing out

/**
 * Finds releases sitting in storage whose release date has already passed
 * but haven't been moved into the already-released category yet. Anything
 * already marked stays untouched, that's the idempotency guarantee, this
 * can be re-run as often as needed without re-processing or double-adding
 * to the playlist.
 */
function findCandidatesToMove(allReleases, todayStr) {
  return allReleases.filter(
    (r) => r.releaseDate && r.releaseDate < todayStr && r.category !== 'already-released'
  );
}

/**
 * Moves up to maxPerRun eligible releases: re-scores each with real search
 * evidence, saves the result over the stale announcement-era score, and adds
 * a Spotify sample only for whatever clears the threshold. A release that
 * doesn't exist on Spotify is recorded as such, not treated as an error.
 */
async function runAlreadyReleasedMove({ maxPerRun = DEFAULT_MAX_PER_RUN, now = new Date() } = {}) {
  const todayStr = now.toISOString().slice(0, 10);
  const allReleases = await getAllReleases();
  const candidates = findCandidatesToMove(allReleases, todayStr);
  const toProcess = candidates.slice(0, maxPerRun);

  const results = [];

  for (const release of toProcess) {
    let scored;
    try {
      scored = await scoreAlreadyReleased({
        artist: release.artist,
        title: release.albumTitle,
        releaseDate: release.releaseDate,
      });
    } catch (err) {
      results.push({ artist: release.artist, albumTitle: release.albumTitle, error: `scoring failed: ${err.message}` });
      continue;
    }

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
    });

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
    stillQueued: candidates.length - results.length,
    results,
  };
}

module.exports = { runAlreadyReleasedMove, findCandidatesToMove, SCORE_THRESHOLD_FOR_PLAYLIST, DEFAULT_MAX_PER_RUN };
