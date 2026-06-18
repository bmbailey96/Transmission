const { runWikipediaBackfill } = require('../../lib/discovery/runWikipediaBackfill');

// Sized to comfortably fit inside the 15 minute background window even if individual
// items run slower than average; tune down if a run is getting cut off mid-batch, tune
// up once real timing across a few runs confirms there's headroom to spare.
const BACKGROUND_MAX_PER_RUN = 40;

exports.handler = async function () {
  try {
    const result = await runWikipediaBackfill({ maxPerRun: BACKGROUND_MAX_PER_RUN });
    console.log(`Wikipedia backlog background run: processed ${result.processed}, ${result.stillQueued} still queued`);
  } catch (err) {
    // Nothing is listening for this response, the function log is the only record of a failure.
    console.error('Wikipedia backlog background run failed:', err);
  }
  return { statusCode: 200 };
};
