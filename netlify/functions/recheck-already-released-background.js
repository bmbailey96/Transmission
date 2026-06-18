const { runRecheckAlreadyReleasedScores } = require('../../lib/discovery/recheckAlreadyReleasedScores');

// Lighter per-item cost than the Wikipedia scoring backfill (a plain consistency
// check, plus only an occasional Spotify removal), starting at the same proven
// batch size as that one; can push higher once real timing confirms there's room.
const BACKGROUND_MAX_PER_RUN = 40;

exports.handler = async function () {
  try {
    const result = await runRecheckAlreadyReleasedScores({ maxPerRun: BACKGROUND_MAX_PER_RUN });
    console.log(`Recheck background run: processed ${result.processed}, ${result.stillQueued} still queued`);
  } catch (err) {
    console.error('Recheck background run failed:', err);
  }
  return { statusCode: 200 };
};
