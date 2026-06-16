const { parseRssFeed } = require('../../lib/discovery/parseRssFeed');
const { extractCandidate } = require('../../lib/discovery/extractCandidate');
const { scoreRelease } = require('../../lib/scoring/scoreRelease');
const { fetchArt } = require('../../lib/art/fetchArt');

const FEED_URL = 'https://www.brooklynvegan.com/feed/';
const ITEM_LIMIT = 8;

function renderSkipped(title) {
  return `<div class="skip">skipped: ${title}</div>`;
}

function renderCard(c) {
  return `<div class="card">
    ${c.art?.url ? `<img src="${c.art.url}" />` : `<div class="placeholder">no art yet</div>`}
    <div class="info">
      <div class="title">${c.artist} - ${c.albumTitle}</div>
      <div class="date">${c.releaseDate || 'date not stated in this post'}</div>
      ${
        c.score !== undefined
          ? `<div class="score">${c.score}% (${c.evidenceLevel})</div><div class="reason">${c.reasoning}</div>`
          : `<div class="reason err">scoring failed: ${c.scoreError}</div>`
      }
      <div class="src"><a href="${c.link}">source</a></div>
    </div>
  </div>`;
}

exports.handler = async function () {
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

  const cards = [];
  const skipped = [];

  for (const item of items) {
    let extracted;
    try {
      extracted = await extractCandidate(item);
    } catch (err) {
      skipped.push(`${item.title} (extraction failed: ${err.message})`);
      continue;
    }

    if (!extracted.isAlbumAnnouncement) {
      skipped.push(item.title);
      continue;
    }

    const candidate = {
      artist: extracted.artist,
      albumTitle: extracted.albumTitle,
      releaseDate: extracted.releaseDate,
      link: item.link,
    };

    try {
      const scored = await scoreRelease({
        artist: extracted.artist,
        title: extracted.albumTitle,
        evidenceText: extracted.evidenceText,
      });
      candidate.score = scored.score;
      candidate.evidenceLevel = scored.evidenceLevel;
      candidate.reasoning = scored.reasoning;
    } catch (err) {
      candidate.scoreError = err.message;
    }

    try {
      candidate.art = await fetchArt({ artist: extracted.artist, title: extracted.albumTitle });
    } catch (err) {
      candidate.art = { url: null, source: 'error' };
    }

    cards.push(candidate);
  }

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
<p>Pulled the ${items.length} most recent posts from the real feed just now, ran each one through the extraction step to decide if it's actually a new album announcement.</p>
<h2>Flagged as album announcements (${cards.length})</h2>
${cards.length ? cards.map(renderCard).join('\n') : '<p>None this run, try again later, the feed changes constantly.</p>'}
<h2>Correctly skipped (${skipped.length})</h2>
${skipped.length ? skipped.map(renderSkipped).join('\n') : '<p>Nothing skipped.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
