const assert = require('node:assert/strict');
const scoring = require('../lib/scoring/scoreAlreadyReleased');
scoring.scoreAlreadyReleased = async () => {throw Error('Your credit balance is too low');};
const {transitionReleases} = require('../lib/v2/engine');
(async()=>{
  const r = {artist:'Test',albumTitle:'Test',lifecycle:'upcoming',releaseDate:'2026-09-01',score:72,evidenceLevel:'none',art:{url:'https://example.com/art.jpg'},spotify:{status:'not_needed',attempts:0}};
  const state = {releases:{test:r},events:[]};
  assert.equal(await transitionReleases(state,'2026-10-04'),1);
  assert.equal(r.lifecycle,'released');
  assert.equal(r.score,72);
  assert.equal(r.evidenceLevel,'none');
  assert.equal(r.scoredReleasedAt,undefined);
  assert.equal(r.spotify.status,'not_needed');
  assert.match(r.releaseScoreError,/credit balance/);
  assert.ok(r.releaseScoreRetryAt);
  console.log('Scoring outage retains prediction and advances release date');
})().catch(err=>{console.error(err);process.exitCode=1});
