const { extractCandidate } = require('./extractCandidate');
const { scoreRelease } = require('../scoring/scoreRelease');
const { fetchArt } = require('../art/fetchArt');
const { upsertRelease, getRelease, getKnownReleaseKeys, releaseKey } = require('../storage/releaseStore');
const { hasSeenItem, markItemSeen } = require('../storage/seenItemsStore');

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

/**
 * For sources that arrive already-structured (artist/title/date known for
 * certain, no classification needed) and potentially large, like Wikipedia's
 * album list. Checks against a single cheap key-set lookup rather than one
 * storage read per entry, and only scores up to maxNew of the soonest-by-date
 * unknown entries per run, so a thousand-entry backlog drains gradually
 * across many runs instead of all at once.
 */
async function runStructuredPass(entries, maxNew = 15) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = entries.filter((e) => e.releaseDate && e.releaseDate >= todayStr);
  const sorted = [...upcoming].sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
  const knownKeys = await getKnownReleaseKeys();

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

  return { cards, alreadyKnown, skipped: [], stillQueued, totalConsidered: sorted.length };
}

module.exports = { runDiscoveryPass, runStructuredPass };
