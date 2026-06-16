/**
 * Fallback chain for cover art. Tries each tier in order, returns the first hit.
 * Caller is responsible for caching the result against the release so this doesn't
 * rerun on every page load, and for re-running it later to upgrade a placeholder or
 * a low-res hit once something better exists.
 */

async function trySpotify(artist, title) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) return null;
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`album:${title} artist:${artist}`)}&type=album&limit=5`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const match = data.albums?.items?.[0];
  if (!match?.images?.[0]?.url) return null;
  return { url: match.images[0].url, source: 'spotify' };
}

async function tryOgImage(pageUrl, sourceLabel) {
  if (!pageUrl) return null;
  const res = await fetch(pageUrl);
  if (!res.ok) return null;
  const html = await res.text();
  const match =
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (!match) return null;
  return { url: match[1], source: sourceLabel || 'og:image' };
}

// NOTE: tested live against real releases while building this. iTunes has real catalog
// gaps, e.g. it fully indexes Slow Pulp's singles but misses their actual "Yard" album
// even at limit=50, so this can't be the only or primary source, only a fallback layer.
async function tryItunes(artist, title) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    artist + ' ' + title
  )}&entity=album&limit=10&country=US`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const match =
    data.results?.find(
      (r) =>
        r.artistName?.toLowerCase().includes(artist.toLowerCase()) ||
        artist.toLowerCase().includes((r.artistName || '').toLowerCase())
    ) || data.results?.[0];
  if (!match?.artworkUrl100) return null;
  // iTunes returns a small image by default, this swaps the size in the url for a much larger one
  const highRes = match.artworkUrl100.replace('100x100', '1200x1200');
  return { url: highRes, source: 'itunes' };
}

// Tested live: MusicBrainz + the Cover Art Archive resolved cleanly for a real album
// search, this is the most reliable structured fallback of the bunch.
async function tryMusicBrainzCoverArt(artist, title) {
  const searchUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(
    `artist:${artist} AND release:${title}`
  )}&fmt=json`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'transmission-release-radar/0.1 (personal use)' },
  });
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const mbid = searchData['release-groups']?.[0]?.id;
  if (!mbid) return null;

  const artRes = await fetch(`https://coverartarchive.org/release-group/${mbid}/front`, {
    redirect: 'follow',
  });
  if (!artRes.ok) return null;
  return { url: artRes.url, source: 'musicbrainz' };
}

/**
 * release: { artist, title, bandcampUrl?, pressUrl? }
 * Order: Spotify, Bandcamp's own page (tested live, works even pre-release since
 * pre-order pages already carry final art), iTunes, MusicBrainz/Cover Art Archive,
 * then whatever press article confirmed the release. Returns a placeholder marker
 * if nothing was found anywhere, rather than pretending.
 */
async function fetchArt(release) {
  const attempts = [
    () => trySpotify(release.artist, release.title),
    () => tryOgImage(release.bandcampUrl, 'bandcamp'),
    () => tryItunes(release.artist, release.title),
    () => tryMusicBrainzCoverArt(release.artist, release.title),
    () => tryOgImage(release.pressUrl, 'press'),
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (err) {
      continue; // one source failing shouldn't break the chain
    }
  }

  return { url: null, source: 'placeholder' };
}

module.exports = { fetchArt, tryItunes, trySpotify, tryMusicBrainzCoverArt, tryOgImage };
