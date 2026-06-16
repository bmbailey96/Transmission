require('dotenv').config();
const { fetchArt } = require('../lib/art/fetchArt');

const cases = [
  { artist: 'Slow Pulp', title: 'Yard' }, // already out (2023), just a known-good sanity check
  { artist: 'Slow Pulp', title: 'Melodie' }, // the actual upcoming one
  { artist: 'Julia Jacklin', title: 'The Gem' },
];

async function main() {
  for (const c of cases) {
    const result = await fetchArt(c);
    console.log(
      `${c.artist} - ${c.title}: found via ${result.source}${
        result.url ? '\n  ' + result.url : ' (nothing found anywhere yet)'
      }`
    );
  }
}

main();
