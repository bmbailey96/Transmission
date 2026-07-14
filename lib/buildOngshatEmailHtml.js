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
 * full extended-streaming-history export. Returns null for any artist never
 * actually listened to, that absence is itself a real, useful signal, not
 * just a missing value.
 */
function getArtistListeningStats(artistName) {
  const key = slugifyArtist(artistName);
  return artistSummary[key] || null;
}

/**
 * Builds the prompt section describing real listening history for an
 * artist, or its explicit absence. Trajectory (total listens vs the last
 * 12 months) is left for the model to read and reason about in its own
 * words rather than handed a pre-computed verdict, since "5000 listens but
 * only 31 this year" and "5000 listens, 4000 this year" should land very
 * differently and a flat label would flatten that distinction.
 */
function buildListeningHistorySection(artistName) {
  const stats = getArtistListeningStats(artistName);
  if (!stats) {
    return `\n\n# Your real Spotify listening history with this artist\nNo listening history with this artist in your Spotify data at all.`;
  }
  return `\n\n# Your real Spotify listening history with this artist\n${stats.totalListens} real listens total, spanning ${stats.firstListen} to ${stats.lastListen}. Of those, ${stats.last12moListens} were in the last 12 months. Let this inform whether this artist is a deep, current fixture or a closed chapter, don't just treat the lifetime total at face value.`;
}

module.exports = { getArtistListeningStats, slugifyArtist, buildListeningHistorySection };
