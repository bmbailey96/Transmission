const assert = require('node:assert/strict');
const { releaseKey } = require('../lib/v2/store');
const { lifecycleFor, spotifyBackoffHours, safeIsoDate, SCORE_FOR_SPOTIFY, spotifyEligible } = require('../lib/v2/engine');
const { picks, toHear, anticipated } = require('../data/curated2026');
const { pickTracks, MAX_ACTIVE_TRACKS } = require('../lib/spotify/spotifyPlaylist');

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

assert.equal(SCORE_FOR_SPOTIFY, 85);
assert.equal(MAX_ACTIVE_TRACKS, 50);
assert.equal(picks.length, 40);
assert.equal(toHear.length, 5);
assert.equal(anticipated.length, 11);
assert.equal(spotifyEligible({artist:'Julia Jacklin',albumTitle:'The Gem',lifecycle:'released',score:95}), false);
assert.equal(spotifyEligible({artist:'Unknown Artist',albumTitle:'New Album',lifecycle:'released',score:84}), false);
assert.equal(spotifyEligible({artist:'Unknown Artist',albumTitle:'New Album',lifecycle:'released',score:86}), true);
const sampleTracks = [
  {id:'intro',name:'Intro',duration_ms:38000,track_number:1},
  {id:'one',name:'A Real Song',duration_ms:180000,track_number:2},
  {id:'two',name:'Another Song',duration_ms:210000,track_number:3},
];
assert.equal(pickTracks(sampleTracks, [], 1)[0].id, 'one');

console.log('Transmission V2 logic checks passed');
