const { connectLambda } = require('@netlify/blobs');
const { fetchAllFeedItems } = require('../../lib/discovery/fetchAllFeedItems');
const { fetchUpcomingAlbums } = require('../../lib/discovery/wikipediaAlbumList');
const { runDiscoveryPass, runStructuredPass } = require('../../lib/discovery/runDiscoveryPass');

exports.handler = async function (event) {
  connectLambda(event);

  const { allItems, feedErrors, counts } = await fetchAllFeedItems();

  if (feedErrors.length) {
    feedErrors.forEach((e) => console.error(`Scheduled discovery: ${e.feed} feed fetch failed:`, e.error));
  }
  console.log('Items pulled per feed:', counts.map((c) => `${c.feed}=${c.count}`).join(', '));

  const { cards, alreadyKnown, skipped } = await runDiscoveryPass(allItems);

  console.log(
    `RSS pass complete. ${cards.length} new, ${alreadyKnown.length} already known, ${skipped.length} skipped.`
  );
  cards.forEach((c) => {
    console.log(`  NEW (RSS): ${c.artist} - ${c.albumTitle} (${c.score ?? 'no score'}%)`);
  });

  try {
    const wikiEntries = await fetchUpcomingAlbums();
    const wikiResult = await runStructuredPass(wikiEntries);
    console.log(
      `Wikipedia pass complete. ${wikiResult.cards.length} new (${wikiResult.watchlistCount} watchlist, ${wikiResult.cards.length - wikiResult.watchlistCount} throttled), ${wikiResult.alreadyKnown.length} already known, ${(wikiResult.backfilled || []).length} backfilled, ${wikiResult.stillQueued} still queued out of ${wikiResult.totalConsidered} total entries.`
    );
    wikiResult.cards.forEach((c) => {
      console.log(`  NEW (Wikipedia): ${c.artist} - ${c.albumTitle} (${c.score ?? 'no score'}%)`);
    });
    (wikiResult.backfilled || []).forEach((b) => {
      console.log(`  BACKFILLED: ${b}`);
    });
  } catch (err) {
    console.error('Wikipedia pass failed:', err.message);
  }

  return { statusCode: 200, body: 'ok' };
};