const { getAllReleases, upsertRelease } = require('../storage/releaseStore');
const { checkScoreConsistency } = require('../scoring/checkScoreConsistency');
const {
  searchAlbum,
  getAlbumTracks,
  pickTracks,
  getAccessToken,
  findOrCreatePlaylist,
  removeUrisFromPlaylist,
} = require('../spotify/spotifyPlaylist');
const { SCORE_THRESHOLD_FOR_PLAYLIST } = require('./alreadyReleasedCandidate');

const DEFAULT_MAX_PER_RUN = 1; // a plain consistency call plus a possible Spotify removal, lighter than the original scoring flow but keeping this conservative until proven otherwise

/**
 * Anything already-released, already at or above the playlist threshold, and
 * never run through the consistency check, since that check didn't exist yet
 * when it was scored. Once checked, consistencyCheck gets set, which keeps
 * this idempotent, a re-run won't reprocess the same entries.
 */
function findUncheckedHighScorers(allReleases) {
  return allReleases.filter(
    (r) =>
      r.category === 'already-released' &&
      typeof r.score === 'number' &&
      r.score >= SCORE_THRESHOLD_FOR_PLAYLIST &&
      !r.consistencyCheck
  );
}

/**
 * Re-derives exactly the track URIs that would have been picked under the
 * original add logic, so removal targets the same tracks precisely rather
 * than guessing. Returns an empty list if the album isn't found, same
 * not-an-error convention as the rest of this pipeline.
 */
async function findPickedUris(token, artist, albumTitle, standoutTracks) {
  const album = await searchAlbum(token, artist, albumTitle);
  if (!album) return [];
  const tracks = await getAlbumTracks(token, album.id);
  const picked = pickTracks(tracks, standoutTracks || [], 5);
  return picked.map((t) => t.uri);
}

async function recheckOneRelease(release) {
  const result = await checkScoreConsistency({
    headline: release.headline,
    reasoning: release.reasoning,
    score: release.score,
  });

  const consistencyCheck = {
    consistent: result.consistent,
    direction: result.direction,
    explanation: result.explanation,
    originalScore: release.score,
  };

  const newScore = result.consistent ? release.score : result.suggestedScore;
  const droppedBelowThreshold = !result.consistent && newScore < SCORE_THRESHOLD_FOR_PLAYLIST;

  let spotifyRemoval = { attempted: false };
  if (droppedBelowThreshold) {
    try {
      const token = await getAccessToken();
      const playlistId = await findOrCreatePlaylist(token);
      const uris = await findPickedUris(token, release.artist, release.albumTitle, release.standoutTracks);
      if (uris.length > 0) {
        await removeUrisFromPlaylist(token, playlistId, uris);
      }
      spotifyRemoval = { attempted: true, removedCount: uris.length };
    } catch (err) {
      spotifyRemoval = { attempted: true, error: err.message };
    }
  }

  await upsertRelease({
    artist: release.artist,
    albumTitle: release.albumTitle,
    score: newScore,
    consistencyCheck,
  });

  return {
    artist: release.artist,
    albumTitle: release.albumTitle,
    originalScore: release.score,
    newScore,
    consistent: result.consistent,
    droppedBelowThreshold,
    spotifyRemoval,
  };
}

async function runRecheckAlreadyReleasedScores({ maxPerRun = DEFAULT_MAX_PER_RUN } = {}) {
  const allReleases = await getAllReleases();
  const candidates = findUncheckedHighScorers(allReleases);
  const toProcess = candidates.slice(0, maxPerRun);

  const results = [];
  for (const release of toProcess) {
    try {
      results.push(await recheckOneRelease(release));
    } catch (err) {
      results.push({ artist: release.artist, albumTitle: release.albumTitle, error: err.message });
    }
  }

  return {
    totalCandidates: candidates.length,
    processed: results.length,
    stillQueued: candidates.length - results.length,
    results,
  };
}

module.exports = { runRecheckAlreadyReleasedScores, findUncheckedHighScorers, DEFAULT_MAX_PER_RUN };
