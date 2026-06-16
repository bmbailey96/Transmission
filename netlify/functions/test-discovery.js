const { connectLambda } = require('@netlify/blobs');
const { fetchAllFeedItems } = require('../../lib/discovery/fetchAllFeedItems');
const { runDiscoveryPass } = require('../../lib/discovery/runDiscoveryPass');
const { getAllReleases } = require('../../lib/storage/releaseStore');

function renderSkipped(title) {
  return `<div class="skip">skipped: ${title}</div>`;
}

function renderCard(c) {
  return `<div class="card">
    ${c.art?.url ? `<img src="${c.art.url}" />` : `<div class="placeholder">no art yet</div>`}
    <div class="info">
      <div class="title">${c.artist} - ${c.albumTitle}</div>
      <div class="date">${c.releaseDate || 'date not stated'}${c.sourceFeed ? ` &middot; ${c.sourceFeed}` : ''}</div>
      ${
        c.score !== undefined
          ? `<div class="score">${c.score}% (${c.evidenceLevel})</div><div class="reason">${c.reasoning}</div>`
          : `<div class="reason err">scoring failed: ${c.scoreError}</div>`
      }
      ${c.saveError ? `<div class="reason err">save failed: ${c.saveError}</div>` : ''}
    </div>
  </div>`;
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

  const { allItems, feedErrors, counts } = await fetchAllFeedItems();

  const { cards, alreadyKnown, skipped } = await runDiscoveryPass(allItems);

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
<h1>Discovery test: live across all feeds</h1>
<p><a href="/">&larr; back</a></p>
<p>Pulled from ${counts.length} feeds just now: ${counts.map((c) => `${c.feed} (${c.count})`).join(', ')}.</p>
${feedErrors.length ? `<p class="err">Feed errors: ${feedErrors.map((e) => `${e.feed}: ${e.error}`).join(' | ')}</p>` : ''}
<h2>Already saved from before this run (${alreadySaved.length})</h2>
${
  storageError
    ? `<p class="err">Storage error: ${storageError}</p>`
    : alreadySaved.length
    ? alreadySaved.map(renderCard).join('\n')
    : '<p>Nothing saved yet, this would be the first run to save anything.</p>'
}
<h2>Found and scored just now, genuinely new (${cards.length})</h2>
${cards.length ? cards.map(renderCard).join('\n') : '<p>None this run.</p>'}
<h2>Already known, left alone (${alreadyKnown.length})</h2>
${alreadyKnown.length ? alreadyKnown.map((t) => `<div class="skip">already scored earlier: ${t}</div>`).join('\n') : '<p>Nothing in this batch was already known.</p>'}
<h2>Skipped this run (${skipped.length})</h2>
${skipped.length ? skipped.map(renderSkipped).join('\n') : '<p>Nothing skipped.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
