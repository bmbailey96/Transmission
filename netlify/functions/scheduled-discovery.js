const { connectLambda } = require('@netlify/blobs');
const { parseRssFeed } = require('../../lib/discovery/parseRssFeed');
const { runDiscoveryPass } = require('../../lib/discovery/runDiscoveryPass');

const FEED_URL = 'https://www.brooklynvegan.com/feed/';
const ITEM_LIMIT = 6;

exports.handler = async function (event) {
  connectLambda(event);

  let items;
  try {
    items = await parseRssFeed(FEED_URL);
  } catch (err) {
    console.error('Scheduled discovery: feed fetch failed:', err.message);
    return { statusCode: 200, body: 'feed fetch failed' };
  }

  items = items.slice(0, ITEM_LIMIT);

  const { cards, alreadyKnown, skipped } = await runDiscoveryPass(items);

  console.log(
    `Scheduled discovery run complete. ${cards.length} new, ${alreadyKnown.length} already known, ${skipped.length} skipped.`
  );
  cards.forEach((c) => {
    console.log(`  NEW: ${c.artist} - ${c.albumTitle} (${c.score ?? 'no score'}%)`);
  });

  return { statusCode: 200, body: 'ok' };
};
