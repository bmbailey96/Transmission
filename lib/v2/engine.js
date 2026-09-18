const { fetchAllFeedItems } = require('../discovery/fetchAllFeedItems');
const { extractCandidate } = require('../discovery/extractCandidate');
const { fetchUpcomingAlbums } = require('../discovery/wikipediaAlbumList');
const { fetchArt } = require('../art/fetchArt');
const { scoreRelease } = require('../scoring/scoreRelease');
const { scoreAlreadyReleased } = require('../scoring/scoreAlreadyReleased');
const { addAlbumToPlaylist } = require('../spotify/spotifyPlaylist');
const { getAllReleases: getLegacyReleases } = require('../storage/releaseStore');
const { artists: watchlistArtists } = require('../../data/watchlist');
const { releaseKey, getState, saveState, addEvent, allReleases } = require('./store');

const SCORE_FOR_SPOTIFY = 50;
const MAX_RSS_ITEMS = 8;
const MAX_WIKI_NEW = 7;
const MAX_RELEASE_TRANSITIONS = 3;
const MAX_SPOTIFY_RETRIES = 2;
const watchlist = new Set(watchlistArtists.map(a => a.toLowerCase()));

function todayMountain() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function isoDaysFrom(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lifecycleFor(releaseDate, today) {
  return releaseDate && releaseDate <= today ? 'released' : 'upcoming';
}

function normalizeLegacy(r, today) {
  const lifecycle = r.category === 'already-released' || (r.releaseDate && r.releaseDate <= today)
    ? 'released' : 'upcoming';
  let spotify = { status: 'not_needed', attempts: 0 };
  if (r.spotifyStatus?.found) spotify = { status: 'added', attempts: 1, detail: r.spotifyStatus };
  else if (r.spotifyStatus?.attempted && r.spotifyStatus?.error) {
    spotify = { status: 'error', attempts: r.spotifyRetryCount || 1, error: r.spotifyStatus.error };
  } else if (r.spotifyStatus?.attempted && r.spotifyStatus?.found === false) {
    spotify = { status: 'not_found', attempts: 1 };
  } else if (lifecycle === 'released' && typeof r.score === 'number' && r.score >= SCORE_FOR_SPOTIFY) {
    spotify = { status: 'pending', attempts: 0 };
  }
  return {
    artist: r.artist,
    albumTitle: r.albumTitle,
    releaseDate: r.releaseDate || null,
    lifecycle,
    category: lifecycle === 'released' ? 'already-released' : undefined,
    score: r.score,
    headline: r.headline,
    reasoning: r.reasoning,
    evidenceLevel: r.evidenceLevel || 'none',
    standoutTracks: r.standoutTracks || [],
    art: r.art || { url: null, source: 'placeholder' },
    link: r.link || null,
    sourceFeed: r.sourceFeed || null,
    evidenceText: r.evidenceText || null,
    announcedAt: r.announcedAt || r.discoveredAt || null,
    discoveredAt: r.discoveredAt || new Date().toISOString(),
    scoredUpcomingAt: lifecycle === 'upcoming' ? (r.updatedAt || r.discoveredAt || null) : null,
    scoredReleasedAt: lifecycle === 'released' ? (r.alreadyReleasedAt || r.updatedAt || null) : null,
    spotify,
  };
}

async function seedLegacy(state, today) {
  if (state.legacySeededAt) return 0;
  const old = await getLegacyReleases().catch(() => []);
  const recentFloor = isoDaysFrom(today, -45);
  const keep = old.filter(r =>
    r.artist && r.albumTitle &&
    (
      (r.releaseDate && r.releaseDate >= today) ||
      (r.releaseDate && r.releaseDate >= recentFloor && r.releaseDate <= today)
    )
  );
  for (const r of keep) {
    const key = releaseKey(r.artist, r.albumTitle);
    if (!state.releases[key]) state.releases[key] = normalizeLegacy(r, today);
  }
  state.legacySeededAt = new Date().toISOString();
  addEvent(state, 'seed', `Seeded ${keep.length} currently relevant releases from the legacy store.`);
  return keep.length;
}

function wikiEvidence(e) {
  return `Confirmed release listing: ${e.artist} - "${e.albumTitle}", scheduled for ${e.releaseDate}${e.label ? `, label: ${e.label}` : ''}. No assumptions about the album's sound beyond that listing.`;
}

async function scoreNew({ artist, albumTitle, releaseDate, evidenceText, link, sourceFeed, announcedAt }, today) {
  const released = releaseDate && releaseDate <= today;
  const [scored, art] = await Promise.all([
    released
      ? scoreAlreadyReleased({ artist, title: albumTitle, releaseDate })
      : scoreRelease({ artist, title: albumTitle, evidenceText }),
    fetchArt({ artist, title: albumTitle, pressUrl: link }).catch(() => ({ url: null, source: 'placeholder' })),
  ]);
  return {
    artist, albumTitle, releaseDate: releaseDate || null,
    lifecycle: released ? 'released' : 'upcoming',
    category: released ? 'already-released' : undefined,
    score: scored.score,
    headline: scored.headline,
    reasoning: scored.reasoning,
    evidenceLevel: scored.evidenceLevel || (released ? 'full' : 'none'),
    standoutTracks: scored.standoutTracks || [],
    art,
    link: link || null,
    sourceFeed: sourceFeed || null,
    evidenceText: evidenceText || null,
    announcedAt: announcedAt || null,
    discoveredAt: new Date().toISOString(),
    scoredUpcomingAt: released ? null : new Date().toISOString(),
    scoredReleasedAt: released ? new Date().toISOString() : null,
    spotify: released && scored.score >= SCORE_FOR_SPOTIFY
      ? { status: 'pending', attempts: 0 }
      : { status: 'not_needed', attempts: 0 },
  };
}

function spotifyBackoffHours(attempts) {
  return Math.min(48, 3 * Math.pow(2, Math.max(0, attempts - 1)));
}

async function syncSpotify(release, state) {
  if (release.lifecycle !== 'released' || typeof release.score !== 'number' || release.score < SCORE_FOR_SPOTIFY) {
    release.spotify = { status: 'not_needed', attempts: release.spotify?.attempts || 0 };
    return;
  }
  const attempts = (release.spotify?.attempts || 0) + 1;
  try {
    const result = await addAlbumToPlaylist({
      artist: release.artist,
      albumTitle: release.albumTitle,
      standoutTrackNames: release.standoutTracks || [],
    });
    if (!result.found) {
      release.spotify = { status: 'not_found', attempts, lastAttemptAt: new Date().toISOString() };
      addEvent(state, 'spotify', `${release.artist} - ${release.albumTitle}: not on Spotify.`);
      return;
    }
    release.spotify = {
      status: 'added', attempts, lastAttemptAt: new Date().toISOString(),
      albumId: result.spotifyAlbumId, tracksAdded: result.tracksAdded || [],
      duplicates: result.tracksSkippedAsDuplicate || 0,
    };
    addEvent(state, 'spotify', `${release.artist} - ${release.albumTitle}: Spotify synced.`);
  } catch (err) {
    const next = new Date(Date.now() + spotifyBackoffHours(attempts) * 3600000).toISOString();
    release.spotify = {
      status: attempts >= 5 ? 'quarantined' : 'error',
      attempts, lastAttemptAt: new Date().toISOString(), nextRetryAt: next, error: err.message,
    };
    addEvent(state, 'error', `${release.artist} - ${release.albumTitle}: Spotify failed.`, err.message);
  }
}

async function processRss(state, today) {
  const seen = new Set(state.seenLinks || []);
  const { allItems, feedErrors } = await fetchAllFeedItems();
  const fresh = allItems.filter(i => i.link && !seen.has(i.link)).slice(0, MAX_RSS_ITEMS);
  let added = 0;

  for (const item of fresh) {
    seen.add(item.link);
    let x;
    try { x = await extractCandidate(item); }
    catch (err) {
      addEvent(state, 'error', `RSS extraction failed: ${item.title}`, err.message);
      continue;
    }
    if (!x.isAlbumAnnouncement || !x.artist || !x.albumTitle) continue;
    const key = releaseKey(x.artist, x.albumTitle);
    const existing = state.releases[key];
    if (existing) {
      if (!existing.releaseDate && x.releaseDate) existing.releaseDate = x.releaseDate;
      if (!existing.link) existing.link = item.link;
      continue;
    }
    try {
      const r = await scoreNew({
        artist: x.artist, albumTitle: x.albumTitle, releaseDate: x.releaseDate,
        evidenceText: x.evidenceText, link: item.link, sourceFeed: item.sourceFeed,
        announcedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      }, today);
      state.releases[key] = r;
      if (r.spotify.status === 'pending') await syncSpotify(r, state);
      addEvent(state, 'new', `New signal: ${r.artist} - ${r.albumTitle} (${r.score}%).`);
      added++;
    } catch (err) {
      addEvent(state, 'error', `Could not score ${x.artist} - ${x.albumTitle}.`, err.message);
    }
  }

  state.seenLinks = [...seen].slice(-350);
  for (const e of feedErrors || []) addEvent(state, 'warning', `${e.feed} feed failed.`, e.error);
  return added;
}

async function processWikipedia(state, today) {
  const entries = await fetchUpcomingAlbums(new Date().getFullYear());
  const byKey = new Map(entries.map(e => [releaseKey(e.artist, e.albumTitle), e]));

  // Wikipedia is the date authority. Patch missing dates without rescoring.
  for (const [key, release] of Object.entries(state.releases)) {
    const e = byKey.get(key);
    if (e && !release.releaseDate && e.releaseDate) release.releaseDate = e.releaseDate;
  }

  const low = isoDaysFrom(today, -14);
  const high = isoDaysFrom(today, 210);
  const unknown = entries
    .filter(e => e.releaseDate >= low && e.releaseDate <= high && !state.releases[releaseKey(e.artist, e.albumTitle)])
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  const priority = unknown.filter(e => watchlist.has(e.artist.toLowerCase()));
  const ordinary = unknown.filter(e => !watchlist.has(e.artist.toLowerCase()));
  const chosen = [...priority.slice(0, 4), ...ordinary.slice(0, MAX_WIKI_NEW)].slice(0, MAX_WIKI_NEW);
  let added = 0;
  for (const e of chosen) {
    try {
      const r = await scoreNew({
        artist: e.artist, albumTitle: e.albumTitle, releaseDate: e.releaseDate,
        evidenceText: wikiEvidence(e), sourceFeed: e.sourceFeed,
      }, today);
      state.releases[releaseKey(r.artist, r.albumTitle)] = r;
      if (r.spotify.status === 'pending') await syncSpotify(r, state);
      addEvent(state, 'new', `New listing: ${r.artist} - ${r.albumTitle} (${r.score}%).`);
      added++;
    } catch (err) {
      addEvent(state, 'error', `Wikipedia candidate failed: ${e.artist} - ${e.albumTitle}.`, err.message);
    }
  }
  return added;
}

async function transitionReleases(state, today) {
  const due = allReleases(state)
    .filter(r => r.lifecycle === 'upcoming' && r.releaseDate && r.releaseDate <= today)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
    .slice(0, MAX_RELEASE_TRANSITIONS);
  for (const r of due) {
    try {
      const scored = await scoreAlreadyReleased({
        artist: r.artist, title: r.albumTitle, releaseDate: r.releaseDate,
      });
      r.lifecycle = 'released';
      r.category = 'already-released';
      r.score = scored.score;
      r.headline = scored.headline;
      r.reasoning = scored.reasoning;
      r.evidenceLevel = scored.evidenceLevel || 'full';
      r.standoutTracks = scored.standoutTracks || [];
      r.scoredReleasedAt = new Date().toISOString();
      r.spotify = r.score >= SCORE_FOR_SPOTIFY ? { status: 'pending', attempts: 0 } : { status: 'not_needed', attempts: 0 };
      if (!r.art?.url) {
        r.art = await fetchArt({ artist: r.artist, title: r.albumTitle, pressUrl: r.link }).catch(() => r.art);
      }
      if (r.spotify.status === 'pending') await syncSpotify(r, state);
      addEvent(state, 'released', `Released: ${r.artist} - ${r.albumTitle} rescored at ${r.score}%.`);
    } catch (err) {
      r.releaseTransitionError = err.message;
      addEvent(state, 'error', `Release transition failed: ${r.artist} - ${r.albumTitle}.`, err.message);
    }
  }
  return due.length;
}

async function retrySpotify(state) {
  const now = Date.now();
  const retry = allReleases(state)
    .filter(r =>
      r.lifecycle === 'released' &&
      r.spotify?.status === 'error' &&
      (r.spotify.attempts || 0) < 5 &&
      (!r.spotify.nextRetryAt || new Date(r.spotify.nextRetryAt).getTime() <= now)
    )
    .slice(0, MAX_SPOTIFY_RETRIES);
  for (const r of retry) await syncSpotify(r, state);
  return retry.length;
}

function prune(state, today) {
  const floor = isoDaysFrom(today, -120);
  for (const [key, r] of Object.entries(state.releases)) {
    if (r.lifecycle === 'released' && r.releaseDate && r.releaseDate < floor && (r.score || 0) < 70) {
      delete state.releases[key];
    }
  }
}

async function runEngine() {
  const started = Date.now();
  const today = todayMountain();
  const state = await getState();
  const summary = { seeded: 0, rssAdded: 0, wikiAdded: 0, transitioned: 0, spotifyRetried: 0 };

  summary.seeded = await seedLegacy(state, today);
  summary.rssAdded = await processRss(state, today);
  summary.wikiAdded = await processWikipedia(state, today);
  summary.transitioned = await transitionReleases(state, today);
  summary.spotifyRetried = await retrySpotify(state);
  prune(state, today);

  summary.releaseCount = allReleases(state).length;
  summary.ms = Date.now() - started;
  state.lastRun = { at: new Date().toISOString(), ok: true, ...summary };
  await saveState(state);
  return summary;
}

module.exports = { runEngine, todayMountain };
