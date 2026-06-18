const { upsertRelease } = require('../storage/releaseStore');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');

const SCORE_THRESHOLD_FOR_PLAYLIST = 50; // same bar the rest of the app already uses for "worth surfacing"

/**
 * The one real unit of work shared by every already-released entry point,
 * regardless of where the candidate came from (an existing upcoming release
 * whose date just passed, or a never-before-seen Wikipedia backlog entry).
 * Scores with real search evidence, saves the result, and adds a Spotify
 * sample only for whatever clears the threshold. A release not found on
 * Spotify is recorded as such, not treated as an error, same for a release
 * that fails to score, neither one should take down the whole batch.
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

  await upsertRelease({
    artist: release.artist,
    albumTitle: release.albumTitle,
    releaseDate: release.releaseDate,
    sourceFeed: release.sourceFeed,
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

  return {
    artist: release.artist,
    albumTitle: release.albumTitle,
    score: scored.score,
    evidenceLevel: scored.evidenceLevel,
    spotify,
  };
}

module.exports = { processAlreadyReleasedCandidate, SCORE_THRESHOLD_FOR_PLAYLIST };
