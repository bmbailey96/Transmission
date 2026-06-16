const { scoreRelease } = require('../../lib/scoring/scoreRelease');
const samples = require('../../test/sample-releases.json');

function render(results) {
  const rows = results
    .map((r) =>
      r.error
        ? `<div class="item"><div class="title">${r.artist} - ${r.title}</div><div class="err">FAILED: ${r.error}</div></div>`
        : `<div class="item"><div class="title">${r.artist} - ${r.title}</div><div class="score">${r.score}% <span class="ev">(${r.evidenceLevel})</span></div><div class="reason">${r.reasoning}</div></div>`
    )
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Scoring test</title>
<style>
body{font-family:ui-monospace,monospace;max-width:680px;margin:50px auto;background:#111;color:#eee;padding:0 20px;line-height:1.5}
h1{font-size:1.2em;color:#9fd}
.item{margin-bottom:28px;padding-left:14px;border-left:3px solid #444}
.title{font-weight:bold;margin-bottom:4px}
.score{font-size:1.3em;color:#9fd}
.ev{color:#888;font-size:.7em}
.reason{color:#ccc;margin-top:4px}
.err{color:#f88}
a{color:#9fd}
</style></head><body>
<h1>Scoring engine, live test</h1>
<p><a href="/">&larr; back</a></p>
${rows}
</body></html>`;
}

exports.handler = async function () {
  const results = [];
  for (const release of samples) {
    try {
      const result = await scoreRelease({
        artist: release.artist,
        title: release.title,
        evidenceText: release.evidenceText,
      });
      results.push({ artist: release.artist, title: release.title, ...result });
    } catch (err) {
      results.push({ artist: release.artist, title: release.title, error: err.message });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: render(results),
  };
};
