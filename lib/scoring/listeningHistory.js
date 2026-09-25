const artistSummary = require('../../data/artistListeningHistory.json');

function slugifyArtist(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Looks up real Spotify listening history for an artist, built once from a
 * Spotify extended-streaming-history export. Returns null when the export has
 * no row for an artist; listening outside Spotify is not captured here.
 */
function getArtistListeningStats(artistName) {
  const key = slugifyArtist(artistName);
  return artistSummary[key] || null;
}

/**
 * Builds the prompt section describing real listening history for an
 * artist, or its explicit absence. Trajectory (total listens vs the last
 * 12 months) is context, not an affection score. Listening comes in sprints,
 * so quiet periods must not be treated as rejection.
 */
function buildListeningHistorySection(artistName) {
  const stats = getArtistListeningStats(artistName);
  if (!stats) {
    return `\n\n# Spotify export coverage for this artist\nNo plays appear in this export. It undercounts listening outside Spotify and does not establish dislike or lack of interest. Use direct album judgments and other positive evidence instead.`;
  }
  return `\n\n# Spotify plays recorded for this artist\n${stats.totalListens} plays from ${stats.firstListen} to ${stats.lastListen}; ${stats.last12moListens} in the last 12 months. Repeated plays are useful positive evidence. Quiet periods are not a negative verdict; listening happens in sprints and continues outside Spotify.`;
}

module.exports = { getArtistListeningStats, slugifyArtist, buildListeningHistorySection };
