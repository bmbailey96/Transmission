const { connectLambda } = require('@netlify/blobs');
const { fetchAllFeedItems } = require('../../lib/discovery/fetchAllFeedItems');
const { runDiscoveryPass } = require('../../lib/discovery/runDiscoveryPass');

exports.handler = async function (event) {
  connectLambda(event);

  const { allItems, feedErrors, counts } = await fetchAllFeedItems();

  if (feedErrors.length) {
    feedErrors.forEach((e) => console.error(`Scheduled discovery: ${e.feed} feed fetch failed:`, e.error));
  }
  console.log('Items pulled per feed:', counts.map((c) => `${c.feed}=${c.count}`).join(', '));

  const { cards, alreadyKnown, skipped } = await runDiscoveryPass(allItems);

  console.log(
    `Scheduled discovery run complete. ${cards.length} new, ${alreadyKnown.length} already known, ${skipped.length} skipped.`
  );
  cards.forEach((c) => {
    console.log(`  NEW: ${c.artist} - ${c.albumTitle} (${c.score ?? 'no score'}%)`);
  });

  return { statusCode: 200, body: 'ok' };
};
