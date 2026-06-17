const { connectLambda } = require('@netlify/blobs');
const { getAllReleases, upsertRelease } = require('../../lib/storage/releaseStore');

const MAX_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Tries a handful of common ways pages expose their own publish date,
 * roughly in order of how likely a music blog is to use them. Returns
 * an ISO string on the first one that actually parses, null otherwise.
 */
function extractPublishedDate(html) {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+name=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) {
      const d = new Date(match[1]);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

async function fetchPublishedDate(link) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(link, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractPublishedDate(html);
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async function (event) {
  connectLambda(event);

  let releases = [];
  try {
    releases = await getAllReleases();
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Could not load releases: ' + err.message }),
    };
  }

  const noLink = releases.filter((r) => !r.link);
  const alreadyAttempted = releases.filter((r) => r.link && r.announcedBackfillAttempted);
  const candidates = releases.filter((r) => r.link && !r.announcedAt && !r.announcedBackfillAttempted);
  const toProcess = candidates.slice(0, MAX_PER_RUN);

  const results = await Promise.all(
    toProcess.map(async (release) => {
      let announcedAt = null;
      let fetchError = null;
      try {
        announcedAt = await fetchPublishedDate(release.link);
      } catch (err) {
        fetchError = err.message;
      }
      try {
        await upsertRelease({ ...release, announcedAt, announcedBackfillAttempted: true });
      } catch (err) {
        return { artist: release.artist, albumTitle: release.albumTitle, announcedAt, fetchError, saveError: err.message };
      }
      return { artist: release.artist, albumTitle: release.albumTitle, announcedAt, fetchError };
    })
  );

  const found = results.filter((r) => r.announcedAt);
  const notFound = results.filter((r) => !r.announcedAt);
  const remaining = candidates.length - toProcess.length;

  const row = (r) =>
    `<div class="row">${r.artist} &mdash; ${r.albumTitle}: ${
      r.announcedAt ? `<b>${r.announcedAt.slice(0, 10)}</b>` : r.fetchError ? `<span class="err">fetch failed: ${r.fetchError}</span>` : '<span class="err">no date found on page</span>'
    }</div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Announced-date backfill</title>
<style>
body{font-family:ui-monospace,monospace;max-width:720px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.6}
h1{font-size:1.2em;color:#9fd}
h2{font-size:.95em;color:#888;margin-top:32px;border-bottom:1px solid #333;padding-bottom:6px}
.row{margin-bottom:4px}
.err{color:#f88}
a{color:#9fd}
</style></head><body>
<h1>Announced-date backfill</h1>
<p><a href="/">&larr; back</a></p>
<p>${candidates.length} releases have a link but no real announce date yet. Processed ${toProcess.length} this run: ${found.length} found a real date, ${notFound.length} didn't.</p>
<p>${remaining} still left to process${remaining > 0 ? ', revisit this page to keep going' : ''}. ${noLink.length} releases have no link at all (Wikipedia-sourced) and will never be eligible here. ${alreadyAttempted.length} were already attempted in an earlier run.</p>
<h2>This run (${results.length})</h2>
${results.length ? results.map(row).join('\n') : '<p>Nothing to do.</p>'}
</body></html>`;

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
