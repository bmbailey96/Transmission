const { connectLambda } = require('@netlify/blobs');
const { runAlreadyReleasedMove } = require('../../lib/discovery/runAlreadyReleasedMove');

exports.handler = async function (event) {
  connectLambda(event);

  try {
    const result = await runAlreadyReleasedMove();
    if (result.fatalError) {
      console.error(`Scheduled already-released move: could not load releases at all: ${result.fatalError}`);
    }
    console.log(
      `Scheduled already-released move: processed ${result.processed} (${result.succeeded ?? result.processed} succeeded), ${result.stillQueued} still queued.`
    );
    result.results.forEach((r) => {
      if (r.error) {
        console.error(`  FAILED: ${r.artist} - ${r.albumTitle}: ${r.error}`);
      } else {
        console.log(`  ${r.score}% ${r.artist} - ${r.albumTitle} [${r.evidenceLevel}]`);
      }
    });
  } catch (err) {
    console.error('Scheduled already-released move failed entirely:', err);
  }

  return { statusCode: 200, body: 'ok' };
};
