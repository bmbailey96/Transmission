const { runRescoreUpcoming } = require('../../lib/discovery/rescoreUpcoming');

// Plain (non-search) scoring calls, the same cost class as the original discovery
// scoring itself, cheaper than the search-backed already-released path. Starting
// a bit above that one's proven 40 since each item should be faster.
const BACKGROUND_MAX_PER_RUN = 60;

exports.handler = async function () {
  try {
    const result = await runRescoreUpcoming({ maxPerRun: BACKGROUND_MAX_PER_RUN });
    console.log(`Rescore-upcoming background run: processed ${result.processed}, ${result.stillQueued} still queued`);
  } catch (err) {
    console.error('Rescore-upcoming background run failed:', err);
  }
  return { statusCode: 200 };
};
