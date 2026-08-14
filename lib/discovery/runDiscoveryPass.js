const { extractCandidate } = require('./extractCandidate');
const { scoreRelease } = require('../scoring/scoreRelease');
const { fetchArt } = require('../art/fetchArt');
const { upsertRelease, bulkPatchReleases, getRelease, getAllReleases, releaseKey } = require('../storage/releaseStore');
const { hasSeenItem, markItemSeen } = require('../storage/seenItemsStore');
const { artists: watchlistArtists, labels: watchlistLabels } = require('../../data/watchlist');

const watchlistArtistSet = new Set(watchlistArtists.map((a) => a.toLowerCase()));
const watchlistLabelsLower = watchlistLabels.map((l) => l.toLowerCase());

function isWatchlisted(entry) {
  if (watchlistArtistSet.has((entry.artist || '').toLowerCase())) return true;
  if (entry.label && watchlistLabelsLower.some((l) => entry.label.toLowerCase().includes(l))) return true;
  return false;
}

/**
 * RSS pubDate is when the blog/news post went up, the closest real signal
 * this pipeline has to when something was actually announced, as opposed to
 * discoveredAt, which is just whenever this app's hourly pass happened to
 * crawl it. Returns null on anything missing or unparseable rather than
 * guessing, since a wrong date is worse than no date here.
 */
function parsePubDate(pubDate) {
  if (!pubDate) return null;
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function scoreAndSaveCandidate(candidate) {
  const [scoreResult, artResult] = await Promise.all([
    scoreRelease({
      artist: candidate.artist,
      title: candidate.albumTitle,
      evidenceText: candidate.evidenceText,
    }).catch((err) => ({ error: err.message })),
    fetchArt({ artist: candidate.artist, title: candidate.albumTitle }).catch(() => ({
      url: null,
      source: 'error',
    })),
  ]);

  if (scoreResult.error) {
    candidate.scoreError = scoreResult.error;
  } else {
    candidate.score = scoreResult.score;
    candidate.evidenceLevel = scoreResult.evidenceLevel;
    candidate.headline = scoreResult.headline;
    candidate.reasoning = scoreResult.reasoning;
  }
  candidate.art = artResult;

  if (!candidate.scoreError) {
    try {
      await upsertRelease(candidate);
    } catch (err) {
      candidate.saveError = err.message;
    }
  }

  return candidate;
}

async function processItem(item) {
  const seen = await hasSeenItem(item.link).catch(() => false);
  if (seen) {
    return { skipped: `${item.title} (already looked at this post before)` };
  }

  let extracted;
  try {
    extracted = await extractCandidate(item);
  } catch (err) {
    return { skipped: `${item.title} (extraction failed: ${err.message})` };
  }

  await markItemSeen(item.link).catch(() => {});

  if (!extracted.isAlbumAnnouncement) {
    return { skipped: item.title };
  }

  let existing = null;
  try {
    existing = await getRelease(extracted.artist, extracted.albumTitle);
  } catch (err) {
    existing = null;
  }

  if (existing) {
    return { alreadyKnown: `${extracted.artist} - ${extracted.albumTitle}` };
  }

  const candidate = await scoreAndSaveCandidate({
    artist: extracted.artist,
    albumTitle: extracted.albumTitle,
    releaseDate: extracted.releaseDate,
    link: item.link,
    sourceFeed: item.sourceFeed,
    evidenceText: extracted.evidenceText,
    announcedAt: parsePubDate(item.pubDate),
  });

  return { card: candidate };
}

async function runDiscoveryPass(items) {
  const results = await Promise.all(items.map(processItem));
  return {
    cards: results.filter((r) => r.card).map((r) => r.card),
    alreadyKnown: results.filter((r) => r.alreadyKnown).map((r) => r.alreadyKnown),
    skipped: results.filter((r) => r.skipped).map((r) => r.skipped),
  };
}

function buildWikipediaEvidenceText(entry) {
  return `Confirmed via Wikipedia's running list of album releases: ${entry.artist} - "${entry.albumTitle}", scheduled for ${entry.releaseDate}${entry.label ? `, label: ${entry.label}` : ''}. This is a bare confirmed listing only, no description of sound, no singles, no quotes from the artist.`;
}

function buildWatchlistEvidenceText(entry, matchedOn) {
  return `Confirmed via Wikipedia's running list of album releases: ${entry.artist} - "${entry.albumTitle}", scheduled for ${entry.releaseDate}${entry.label ? `, label: ${entry.label}` : ''}. This person has flagged direct, current interest in this artist or label (matched on: ${matchedOn}), separate from anything in the ranked history above, which may or may not also include them. Check the ranked history yourself for any actual placement rather than assuming one.`;
}

/**
 * For sources that arrive already-structured (artist/title/date known for
 * certain, no classification needed) and potentially large, like Wikipedia's
 * album list. Watchlisted artists/labels (data/watchlist.js) bypass the
 * throttle entirely and get scored every run regardless of date or queue
 * position, since there's no real question whether they're worth surfacing.
 * Everything else only scores up to maxNew of the soonest-by-date unknown
 * entries per run, so a thousand-entry backlog drains gradually across many
 * runs instead of all at once.
 */
async function runStructuredPass(entries, maxNew = 15) {
  const knownReleases = await getAllReleases();
  const knownByKey = new Map(knownReleases.map((r) => [releaseKey(r.artist, r.albumTitle), r]));
  const knownKeys = new Set(knownByKey.keys());

  /**
   * A record can already exist with releaseDate still unset: anything the
   * RSS pass (processItem, above) saves from a bare "X announces an album"
   * post before any date is public goes in with releaseDate: null, and once
   * a record exists at all, both that pass's "already known" check and the
   * "already known" check below treat it as done and never revisit it.
   * Nothing else in this app backfills a missing date later, including once
   * Wikipedia lists a confirmed one, which matters because releaseDate:
   * null satisfies neither the upcoming tab's `releaseDate >= today` filter
   * nor the already-released mover's `releaseDate < today` filter: a real,
   * already-scored release just sits invisible on the site forever. This
   * fixes that specifically, a plain field merge rather than a rescore,
   * since it already has a score and there's no reason to spend another
   * Anthropic call redoing that.
   *
   * This batch goes through bulkPatchReleases (one index read-modify-write
   * for the whole batch), not one upsertRelease() per target. The first
   * version fired a separate upsertRelease() per target via Promise.all,
   * which is fine at the small scale the wikipedia-backlog-background job
   * uses it at (a background function, 15 minute budget, capped at 40 per
   * run), but this pass can find dozens of stale entries in one go, and
   * that many concurrent CAS loops fighting over the same ~1700-entry index
   * blob in a regular, memory-capped sync function actually crashed
   * test-discovery and scheduled-discovery with Runtime.OutOfMemory.
   */
  const backfillTargets = entries.filter((e) => {
    const existing = knownByKey.get(releaseKey(e.artist, e.albumTitle));
    return existing && !existing.releaseDate && e.releaseDate;
  });

  /**
   * These records were all first captured from a bare "X announces an
   * album" post, months before release, which means their art (fetched at
   * that same moment, see scoreAndSaveCandidate) was looked up before the
   * real album existed in any catalog. iTunes in particular used to fall
   * back to just grabbing its first search result with no title check at
   * all when the real one wasn't findable yet (fixed separately in
   * lib/art/fetchArt.js), which is how Phoebe Bridgers' "Lost Weekend" got
   * some other release's cover art back in June. Now that these are
   * confirmed out (that's what backfillTargets means: Wikipedia has a real
   * date for them), a fresh art lookup is far more likely to land
   * correctly. Only worth re-fetching for records that don't already have
   * good art (missing entirely, or previously resolved through the
   * unreliable iTunes tier specifically) — Spotify/Bandcamp/MusicBrainz
   * hits were already verified against the real title and don't need
   * redoing. Capped at ART_REFRESH_LIMIT per run: fetchArt makes up to 5
   * sequential external calls per release, and this pass runs inside a
   * regular (non-background) function, so an unbounded refetch across a
   * large backlog risks the same kind of timeout the very first fix in
   * this file's history was about.
   */
  const ART_REFRESH_LIMIT = 10;
  const needsArtRefresh = (existing) => !existing?.art?.url || existing?.art?.source === 'itunes';
  const artRefreshKeys = new Set(
    backfillTargets
      .filter((e) => needsArtRefresh(knownByKey.get(releaseKey(e.artist, e.albumTitle))))
      .slice(0, ART_REFRESH_LIMIT)
      .map((e) => releaseKey(e.artist, e.albumTitle))
  );

  const backfillPatches = await Promise.all(
    backfillTargets.map(async (entry) => {
      const patch = { artist: entry.artist, albumTitle: entry.albumTitle, releaseDate: entry.releaseDate };
      if (artRefreshKeys.has(releaseKey(entry.artist, entry.albumTitle))) {
        try {
          const freshArt = await fetchArt({ artist: entry.artist, title: entry.albumTitle });
          if (freshArt?.url) patch.art = freshArt;
        } catch (err) {
          // Leave existing art alone on failure, don't downgrade to a placeholder.
        }
      }
      return patch;
    })
  );

  let backfilled = [];
  try {
    const applied = await bulkPatchReleases(backfillPatches);
    const patchByKey = new Map(backfillPatches.map((p) => [releaseKey(p.artist, p.albumTitle), p]));
    backfilled = applied.map((r) => {
      const patch = patchByKey.get(releaseKey(r.artist, r.albumTitle));
      const artNote = patch?.art ? `, art refreshed (${patch.art.source})` : '';
      return `${r.artist} - ${r.albumTitle} (releaseDate was missing, set to ${r.releaseDate}${artNote})`;
    });
  } catch (err) {
    backfilled = [`Backfill batch failed: ${err.message}`];
  }

  const watchlistHits = entries.filter((e) => isWatchlisted(e) && !knownKeys.has(releaseKey(e.artist, e.albumTitle)));
  const watchlistKeys = new Set(watchlistHits.map((e) => releaseKey(e.artist, e.albumTitle)));

  const watchlistCards = await Promise.all(
    watchlistHits.map((entry) =>
      scoreAndSaveCandidate({
        artist: entry.artist,
        albumTitle: entry.albumTitle,
        releaseDate: entry.releaseDate,
        sourceFeed: entry.sourceFeed,
        evidenceText: buildWatchlistEvidenceText(
          entry,
          watchlistArtistSet.has((entry.artist || '').toLowerCase()) ? 'artist' : 'label'
        ),
      })
    )
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const remaining = entries.filter((e) => !watchlistKeys.has(releaseKey(e.artist, e.albumTitle)));
  const upcoming = remaining.filter((e) => e.releaseDate && e.releaseDate >= todayStr);
  const sorted = [...upcoming].sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));

  const alreadyKnown = [];
  const toScore = [];

  for (const entry of sorted) {
    const key = releaseKey(entry.artist, entry.albumTitle);
    if (knownKeys.has(key)) {
      alreadyKnown.push(`${entry.artist} - ${entry.albumTitle}`);
    } else if (toScore.length < maxNew) {
      toScore.push(entry);
    }
  }

  const cards = await Promise.all(
    toScore.map((entry) =>
      scoreAndSaveCandidate({
        artist: entry.artist,
        albumTitle: entry.albumTitle,
        releaseDate: entry.releaseDate,
        sourceFeed: entry.sourceFeed,
        evidenceText: buildWikipediaEvidenceText(entry),
      })
    )
  );

  const stillQueued = sorted.length - alreadyKnown.length - cards.length;

  return {
    cards: [...watchlistCards, ...cards],
    watchlistCount: watchlistCards.length,
    alreadyKnown,
    backfilled,
    skipped: [],
    stillQueued,
    totalConsidered: sorted.length,
  };
}

module.exports = { runDiscoveryPass, runStructuredPass, parsePubDate };