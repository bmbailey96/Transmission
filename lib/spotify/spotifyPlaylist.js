/**
 * Pushes a handful of tracks from an already-released album into a persistent
 * Spotify playlist on Brandon's own account, so he can sample and judge albums
 * himself rather than relying purely on the written score.
 *
 * This uses real user-authorized OAuth (Authorization Code flow, refresh token),
 * NOT the client-credentials flow fetchArt.js uses, since adding tracks to a
 * private playlist requires acting as the actual logged-in user, not just the app.
 *
 * IMPORTANT, found live while building this (Feb 2026 Spotify API changes):
 * track and album `popularity` were removed from the API entirely, there is no
 * "most popular tracks" signal available anymore from any endpoint. Track
 * selection here instead prefers named standout tracks (lead singles, tracks
 * called out in reviews) supplied by the caller, matched against the album's
 * real tracklist, falling back to an even spread across the album for whatever
 * isn't matched. Several playlist endpoints also moved from /tracks to /items
 * this same update; the old paths now 404/410.
 */

const PLAYLIST_NAME = 'Transmission \u2014 Already Released';
const PLAYLIST_DESCRIPTION =
  'Auto-built sampler: up to three tracks from only the strongest already-released album signals. Not a ranking, just enough to judge for yourself.';

function authHeader() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// Found live, Sept 2026: a batch backfill calling addAlbumToPlaylist in a
// tight loop (see backfill-spotify-retry.js) was fetching a brand-new
// access token for every single album, on top of the search/tracks/playlist
// calls each album already makes. That's roughly 2 requests per album to
// Spotify's Accounts service alone with zero delay between them, and it
// tripped a 429 QUOTA_EXCEEDED after about 15 albums, confirmed against a
// real run. The hourly mover never hit this since it only processes one
// album an hour, but anything doing more than a couple per invocation was
// always going to burst a short-window limiter this way. Caching the token
// for the life of one function invocation (Spotify access tokens last about
// an hour; this keeps a comfortable safety margin) cuts that in half and
// means a whole batch shares one token exactly like a human clicking
// through the same session would.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('SPOTIFY_REFRESH_TOKEN is not set');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: authHeader(),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is in seconds (Spotify tokens run ~3600s); refresh 5 minutes
  // early rather than cutting it exactly to the wire.
  cachedTokenExpiresAt = Date.now() + Math.max(0, (data.expires_in || 3600) - 300) * 1000;
  return data.access_token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spotifyFetch(token, path, options = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (res.ok) {
      if (res.status === 204) return null;
      return res.json();
    }

    // Spotify explicitly tells clients how long to back off after a 429.
    // Obey it rather than turning a temporary quota response into a lost album.
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = Math.max(1, Number(res.headers.get('retry-after')) || 1);
      await sleep(Math.min(retryAfter, 12) * 1000);
      continue;
    }

    // One short retry for transient server failures. Auth and request errors
    // are not retried here because repeating a bad credential/request does
    // nothing except burn requests.
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(attempt * 750);
      continue;
    }

    const body = await res.text();
    throw new Error(`Spotify ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  throw new Error(`Spotify ${options.method || 'GET'} ${path} failed after retries`);
}

/**
 * Finds the existing playlist by name, or creates it if this is the first run.
 * Caches the id in module memory for the life of the function instance, since
 * a cold start happens at most once per scheduled run anyway.
 */
let cachedPlaylistId = null;

async function findOrCreatePlaylist(token) {
  if (cachedPlaylistId) return cachedPlaylistId;

  let url = '/me/playlists?limit=50';
  while (url) {
    const page = await spotifyFetch(token, url);
    const existing = page.items.find((p) => p.name === PLAYLIST_NAME);
    if (existing) {
      cachedPlaylistId = existing.id;
      return cachedPlaylistId;
    }
    url = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
  }

  const created = await spotifyFetch(token, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: PLAYLIST_NAME,
      description: PLAYLIST_DESCRIPTION,
      public: false,
    }),
  });
  cachedPlaylistId = created.id;
  return cachedPlaylistId;
}

/** Best-effort album search. Returns null rather than throwing if nothing matches. */
function albumMatchScore(album, artist, albumTitle) {
  const wantedArtist = normalize(artist);
  const wantedTitle = normalize(albumTitle);
  const gotTitle = normalize(album?.name || '');
  const gotArtists = (album?.artists || []).map((a) => normalize(a.name || ''));

  let score = 0;
  if (gotTitle === wantedTitle) score += 6;
  else if (gotTitle.includes(wantedTitle) || wantedTitle.includes(gotTitle)) score += 3;

  if (gotArtists.some((a) => a === wantedArtist)) score += 6;
  else if (gotArtists.some((a) => a.includes(wantedArtist) || wantedArtist.includes(a))) score += 3;
  return score;
}

async function searchAlbum(token, artist, albumTitle) {
  const searches = [
    `artist:${artist} album:${albumTitle}`,
    `${artist} ${albumTitle}`,
  ];

  let best = null;
  let bestScore = -1;
  for (const q of searches) {
    const data = await spotifyFetch(token, `/search?q=${encodeURIComponent(q)}&type=album&limit=10`);
    for (const album of data.albums?.items || []) {
      const score = albumMatchScore(album, artist, albumTitle);
      if (score > bestScore) {
        best = album;
        bestScore = score;
      }
    }
    if (bestScore >= 12) break;
  }

  // Do not add tracks from a plausible-looking first search result unless
  // both the album and artist actually resemble the release we asked for.
  return bestScore >= 6 ? best : null;
}

async function getAlbumTracks(token, albumId) {
  const data = await spotifyFetch(token, `/albums/${albumId}/tracks?limit=50`);
  return data.items;
}

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[(\[][^)\]]*[)\]]/g, '') // strip "(feat. X)", "(Remastered 2021)", etc.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Picks up to `count` tracks: named standouts first (matched fuzzily against the
 * real tracklist), then an even spread across whatever's left, so a handful of
 * intro/interlude tracks don't eat a slot just by being early in the running order.
 * Returns results re-sorted by actual track number so the playlist plays in album order.
 */
function pickTracks(tracks, standoutNames = [], count = 5) {
  if (tracks.length <= count) return [...tracks].sort((a, b) => a.track_number - b.track_number);

  const normalizedTracks = tracks.map((t) => ({ track: t, norm: normalize(t.name) }));
  const matched = [];
  const matchedIds = new Set();

  for (const standout of standoutNames) {
    const normStandout = normalize(standout);
    if (!normStandout) continue;
    const hit = normalizedTracks.find(
      (nt) => !matchedIds.has(nt.track.id) && (nt.norm.includes(normStandout) || normStandout.includes(nt.norm))
    );
    if (hit) {
      matched.push(hit.track);
      matchedIds.add(hit.track.id);
    }
    if (matched.length >= count) break;
  }

  const remainingCount = count - matched.length;
  const pool = tracks.filter((t) => !matchedIds.has(t.id));
  const filled = [];
  if (remainingCount > 0 && pool.length > 0) {
    const step = pool.length / remainingCount;
    const seen = new Set();
    for (let i = 0; i < remainingCount; i++) {
      let idx = Math.min(pool.length - 1, Math.floor(i * step));
      while (seen.has(idx) && idx < pool.length - 1) idx++;
      seen.add(idx);
      filled.push(pool[idx]);
    }
  }

  return [...matched, ...filled].sort((a, b) => a.track_number - b.track_number);
}

async function getCurrentPlaylistUris(token, playlistId) {
  const uris = [];
  let url = `/playlists/${playlistId}/items?limit=100&fields=items(item(uri)),next`;
  while (url) {
    const page = await spotifyFetch(token, url);
    for (const entry of page.items) if (entry.item?.uri) uris.push(entry.item.uri);
    url = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return uris;
}

async function addUrisToPlaylist(token, playlistId, uris) {
  if (uris.length === 0) return;
  await spotifyFetch(token, `/playlists/${playlistId}/items`, {
    method: 'POST',
    body: JSON.stringify({ uris }),
  });
}

async function removeUrisFromPlaylist(token, playlistId, uris) {
  if (uris.length === 0) return;
  await spotifyFetch(token, `/playlists/${playlistId}/items`, {
    method: 'DELETE',
    body: JSON.stringify({ items: uris.map((uri) => ({ uri })) }),
  });
}

/**
 * Main entry point. standoutTrackNames is optional; an empty/missing array just
 * means every pick comes from the even-spread fallback. Never throws on an album
 * simply not existing on Spotify, that's an expected, common outcome (Bandcamp-only
 * or vinyl-only releases), surfaced instead via `found: false` so the caller can
 * show that in the already-released tab rather than silently dropping it.
 */
async function addAlbumToPlaylist({ artist, albumTitle, standoutTrackNames = [] }) {
  const token = await getAccessToken();
  const playlistId = await findOrCreatePlaylist(token);

  const album = await searchAlbum(token, artist, albumTitle);
  if (!album) return { found: false, artist, albumTitle };

  const tracks = await getAlbumTracks(token, album.id);
  const picked = pickTracks(tracks, standoutTrackNames, 3);
  const pickedUris = picked.map((t) => t.uri);

  const alreadyInPlaylist = await getCurrentPlaylistUris(token, playlistId);
  const newUris = pickedUris.filter((uri) => !alreadyInPlaylist.includes(uri));

  await addUrisToPlaylist(token, playlistId, newUris);

  return {
    found: true,
    artist,
    albumTitle,
    spotifyAlbumId: album.id,
    tracksAdded: picked.filter((t) => newUris.includes(t.uri)).map((t) => t.name),
    tracksSkippedAsDuplicate: picked.length - newUris.length,
  };
}

module.exports = {
  addAlbumToPlaylist,
  // exported for testing
  pickTracks,
  normalize,
  findOrCreatePlaylist,
  searchAlbum,
  getAlbumTracks,
  getCurrentPlaylistUris,
  addUrisToPlaylist,
  removeUrisFromPlaylist,
  getAccessToken,
  PLAYLIST_NAME,
};
