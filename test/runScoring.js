require('dotenv').config();
const { scoreRelease } = require('../lib/scoring/scoreRelease');
const samples = require('./sample-releases.json');

async function main() {
  for (const release of samples) {
    try {
      const result = await scoreRelease({
        artist: release.artist,
        title: release.title,
        evidenceText: release.evidenceText,
      });
      console.log(`\n${release.artist} - ${release.title}`);
      console.log(`  score: ${result.score} (${result.evidenceLevel})`);
      console.log(`  reasoning: ${result.reasoning}`);
    } catch (err) {
      console.error(`\n${release.artist} - ${release.title}`);
      console.error(`  FAILED: ${err.message}`);
    }
  }
}

main();
