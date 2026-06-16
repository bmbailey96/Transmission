const { extractCandidate } = require('./extractCandidate');
const { scoreRelease } = require('../scoring/scoreRelease');
const { fetchArt } = require('../art/fetchArt');
const { upsertRelease, getRelease } = require('../storage/releaseStore');
const { hasSeenItem, markItemSeen } = require('../storage/seenItemsStore');

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

  const candidate = {
    artist: extracted.artist,
    albumTitle: extracted.albumTitle,
    releaseDate: extracted.releaseDate,
    link: item.link,
  };

  const [scoreResult, artResult] = await Promise.all([
    scoreRelease({
      artist: extracted.artist,
      title: extracted.albumTitle,
      evidenceText: extracted.evidenceText,
    }).catch((err) => ({ error: err.message })),
    fetchArt({ artist: extracted.artist, title: extracted.albumTitle }).catch(() => ({
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

module.exports = { runDiscoveryPass };
