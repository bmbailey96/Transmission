const assert = require('node:assert/strict');
const { releaseKey } = require('../lib/v2/store');
const { lifecycleFor, spotifyBackoffHours, safeIsoDate, SCORE_FOR_SPOTIFY } = require('../lib/v2/engine');

assert.equal(releaseKey('Phoebe Bridgers', 'Lost Weekend'), 'phoebe-bridgers__lost-weekend');
assert.equal(releaseKey('Godspeed You! Black Emperor', 'NO TITLE'), 'godspeed-you-black-emperor__no-title');

assert.equal(lifecycleFor('2026-09-18', '2026-09-18'), 'released');
assert.equal(lifecycleFor('2026-09-19', '2026-09-18'), 'upcoming');
assert.equal(lifecycleFor(null, '2026-09-18'), 'upcoming');

assert.equal(spotifyBackoffHours(1), 3);
assert.equal(spotifyBackoffHours(2), 6);
assert.equal(spotifyBackoffHours(5), 48);
assert.equal(spotifyBackoffHours(9), 48);

assert.equal(safeIsoDate('2026-09-18T12:30:00Z'), '2026-09-18T12:30:00.000Z');
assert.equal(safeIsoDate('not a date'), null);
assert.equal(safeIsoDate(null), null);

assert.equal(SCORE_FOR_SPOTIFY, 75);

console.log('Transmission V2 logic checks passed');
