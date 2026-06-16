const { connectLambda } = require('@netlify/blobs');
const { parseRssFeed } = require('../../lib/discovery/parseRssFeed');
const { extractCandidate } = require('../../lib/discovery/extractCandidate');
const { scoreRelease } = require('../../lib/scoring/scoreRelease');
const { fetchArt } = require('../../lib/art/fetchArt');
const { upsertRelease, getAllReleases } = require('../../lib/storage/releaseStore');

const FEED_URL = 'https://www.brooklynvegan.com/feed/';
const ITEM_LIMIT = 6;

function renderSkipped(title) {
  return `<div class="skip">skipped: ${title}</div>`;
}

function renderCard(c) {
  return `<div class="card">
    ${c.art?.url ? `<img src="${c.art.url}" />` : `<div class="placeholder">no art yet</div>`}
    <div class="info">
      <div class="title">${c.artist} - ${c.albumTitle}</div>
      <div class="date">${c.releaseDate || 'date not stated'}</div>
      ${
        c.score !== undefined
          ? `<div class="score">${c.score}% (${c.evidenceLevel})</div><div class="reason">${c.reasoning}</div>`
          : `<div class="reason err">scoring failed: ${c.scoreError}</div>`
      }
      ${c.saveError ? `<div class="reason err">save failed: ${c.saveError}</div>` : ''}
    </div>
  </div>`;
}

async function processItem(item) {
  let extracted;
  try {
    extracted = await extractCandidate(item);
  } catch (err) {
    return { skipped: `${item.title} (extraction failed: ${err.message})` };
  }

  if (!extracted.isAlbumAnnouncement) {
    return { skipped: item.title };
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

function sortByDate(releases) {
  return [...releases].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return 0;
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate.localeCompare(b.releaseDate);
  });
}

exports.handler = async function (event) {
  connectLambda(event);

  let alreadySaved = [];
  let storageError = null;
  try {
    alreadySaved = sortByDate(await getAllReleases());
  } catch (err) {
    storageError = err.message;
  }

  let items;
  try {
    items = await parseRssFeed(FEED_URL);
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<p>Feed fetch failed: ${err.message}</p>`,
    };
  }

  items = items.slice(0, ITEM_LIMIT);

  const results = await Promise.all(items.map(processItem));
  const cards = results.filter((r) => r.card).map((r) => r.card);
  const skipped = results.filter((r) => r.skipped).map((r) => r.skipped);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Discovery test</title>
<style>
body{font-family:ui-monospace,monospace;max-width:720px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.5}
h1{font-size:1.2em;color:#9fd}
h2{font-size:.95em;color:#888;margin-top:36px;border-bottom:1px solid #333;padding-bottom:6px}
.card{display:flex;gap:16px;margin-bottom:24px}
.card img{width:100px;height:100px;object-fit:cover;border-radius:4px;flex-shrink:0}
.placeholder{width:100px;height:100px;background:#333;display:flex;align-items:center;justify-content:center;color:#888;font-size:.7em;text-align:center;border-radius:4px;flex-shrink:0}
.title{font-weight:bold}
.date{color:#888;font-size:.85em}
.score{color:#9fd;font-size:1.1em;margin-top:4px}
.reason{color:#ccc;margin-top:2px}
.err{color:#f88}
.skip{color:#666;font-size:.85em;margin-bottom:6px}
a{color:#9fd}
</style></head><body>
<h1>Discovery test: BrooklynVegan feed, live</h1>
<p><a href="/">&larr; back</a></p>
<p>Pulled the ${items.length} most recent posts just now. Whatever passed got scored, art-fetched, and saved to storage.</p>
<h2>Already saved from before this run (${alreadySaved.length})</h2>
${
  storageError
    ? `<p class="err">Storage error: ${storageError}</p>`
    : alreadySaved.length
    ? alreadySaved.map(renderCard).join('\n')
    : '<p>Nothing saved yet, this would be the first run to save anything.</p>'
}
<h2>Found and saved just now (${cards.length})</h2>
${cards.length ? cards.map(renderCard).join('\n') : '<p>None this run, try again later.</p>'}
<h2>Skipped this run (${skipped.length})</h2>
${skipped.length ? skipped.map(renderSkipped).join('\n') : '<p>Nothing skipped.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
