const { upsertRelease } = require('../storage/releaseStore');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { checkScoreConsistency } = require('../scoring/checkScoreConsistency');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');

const SCORE_THRESHOLD_FOR_PLAYLIST = 50; // same bar the rest of the app already uses for "worth surfacing"

/**
 * The one real unit of work shared by every already-released entry point,
 * regardless of where the candidate came from (an existing upcoming release
 * whose date just passed, or a never-before-seen Wikipedia backlog entry).
 * Scores with real search evidence, checks that score against its own
 * reasoning once it's high enough to matter, saves the result, and adds a
 * Spotify sample only for whatever still clears the threshold afterward.
 */
async function processAlreadyReleasedCandidate(release, now = new Date()) {
  let scored;
  try {
    scored = await scoreAlreadyReleased({
      artist: release.artist,
      title: release.albumTitle,
      releaseDate: release.releaseDate,
    });
  } catch (err) {
    return { artist: release.artist, albumTitle: release.albumTitle, error: `scoring failed: ${err.message}` };
  }

  let effectiveScore = scored.score;
  let consistencyCheck = null;

  // Only worth the extra call where a wrong score actually has a consequence:
  // once it's high enough to add real tracks to a real playlist. A score
  // that never clears this bar doesn't trigger anything either way.
  if (typeof scored.score === 'number' && scored.score >= SCORE_THRESHOLD_FOR_PLAYLIST) {
    try {
      const result = await checkScoreConsistency({
        headline: scored.headline,
        reasoning: scored.reasoning,
        score: scored.score,
      });
      consistencyCheck = {
        consistent: result.consistent,
        direction: result.direction,
        explanation: result.explanation,
        originalScore: scored.score,
      };
      if (!result.consistent) {
        effectiveScore = result.suggestedScore;
      }
    } catch (err) {
      // If the check itself fails, fall back to the original score rather
      // than letting this take down the whole candidate.
      consistencyCheck = { consistent: null, direction: 'check_failed', explanation: err.message, originalScore: scored.score };
    }
  }

  await upsertRelease({
    artist: release.artist,
    albumTitle: release.albumTitle,
    releaseDate: release.releaseDate,
    sourceFeed: release.sourceFeed,
    category: 'already-released',
    score: effectiveScore,
    headline: scored.headline,
    reasoning: scored.reasoning,
    evidenceLevel: scored.evidenceLevel,
    standoutTracks: scored.standoutTracks,
    consistencyCheck,
    alreadyReleasedAt: now.toISOString(),
  });

  let spotify = { attempted: false };
  if (typeof effectiveScore === 'number' && effectiveScore >= SCORE_THRESHOLD_FOR_PLAYLIST) {
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

  return {
    artist: release.artist,
    albumTitle: release.albumTitle,
    score: effectiveScore,
    evidenceLevel: scored.evidenceLevel,
    consistencyCheck,
    spotify,
  };
}

module.exports = { processAlreadyReleasedCandidate, SCORE_THRESHOLD_FOR_PLAYLIST };
