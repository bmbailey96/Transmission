const { fetchArt } = require('../../lib/art/fetchArt');

const cases = [
  { artist: 'Slow Pulp', title: 'Yard' }, // already out, known-good sanity check
  { artist: 'Slow Pulp', title: 'Melodie' }, // the actual upcoming one
  { artist: 'Julia Jacklin', title: 'The Gem' },
];

function render(results) {
  const rows = results
    .map(
      (r) => `<div class="item">
        ${r.url ? `<img src="${r.url}" />` : `<div class="placeholder">no art found anywhere yet</div>`}
        <div><div class="title">${r.artist} - ${r.title}</div><div class="source">found via: ${r.source}</div></div>
      </div>`
    )
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Art fetch test</title>
<style>
body{font-family:ui-monospace,monospace;max-width:680px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.5}
h1{font-size:1.2em;color:#9fd}
.item{display:flex;gap:16px;align-items:center;margin-bottom:24px}
img{width:110px;height:110px;object-fit:cover;border-radius:4px}
.placeholder{width:110px;height:110px;background:#333;display:flex;align-items:center;justify-content:center;color:#888;font-size:.75em;text-align:center;border-radius:4px}
.title{font-weight:bold}
.source{color:#9fd;font-size:.85em}
a{color:#9fd}
</style></head><body>
<h1>Cover art chain, live test</h1>
<p><a href="/">&larr; back</a></p>
${rows}
</body></html>`;
}

exports.handler = async function () {
  const results = [];
  for (const c of cases) {
    const result = await fetchArt(c);
    results.push({ ...c, ...result });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: render(results),
  };
};
