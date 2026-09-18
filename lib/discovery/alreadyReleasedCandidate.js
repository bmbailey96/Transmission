const { upsertRelease } = require('../storage/releaseStore');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');

const SCORE_THRESHOLD_FOR_PLAYLIST = 50; // same bar the rest of the app already uses for "worth surfacing"

/**
 * The one real unit of work shared by every already-released entry point.
 * An album gets one evidence-backed post-release score. There is no second
 * model call grading the first model's prose against its number.
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

  const effectiveScore = scored.score;

  // Spotify attempted BEFORE the save (was after), so its outcome can be
  // persisted in the same write instead of only existing in this
  // function's return value for the life of the request. Nothing here was
  // saved before, which is exactly why an album could score well, get
  // marked already-released, and still never show up in the playlist with
  // no record anywhere of what went wrong.
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

  try {
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
      spotifyStatus: spotify,
      spotifyRetryCount: spotify.error ? 1 : 0,
      spotifyLastAttemptAt: spotify.attempted ? now.toISOString() : null,
      alreadyReleasedAt: now.toISOString(),
    });
  } catch (err) {
    return { artist: release.artist, albumTitle: release.albumTitle, error: `save failed after scoring: ${err.message}` };
  }

  return {
    artist: release.artist,
    albumTitle: release.albumTitle,
    score: effectiveScore,
    evidenceLevel: scored.evidenceLevel,
    spotify,
  };
}

module.exports = { processAlreadyReleasedCandidate, SCORE_THRESHOLD_FOR_PLAYLIST };
