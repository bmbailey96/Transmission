const { parseRssFeed } = require('./parseRssFeed');
const FEEDS = require('./feeds');

const ITEMS_PER_FEED = 6;

async function fetchAllFeedItems() {
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const items = await parseRssFeed(feed.url);
        return {
          feed: feed.name,
          items: items.slice(0, ITEMS_PER_FEED).map((item) => ({ ...item, sourceFeed: feed.name })),
        };
      } catch (err) {
        return { feed: feed.name, items: [], error: err.message };
      }
    })
  );

  const allItems = results.flatMap((r) => r.items);
  const feedErrors = results.filter((r) => r.error).map((r) => ({ feed: r.feed, error: r.error }));
  const counts = results.map((r) => ({ feed: r.feed, count: r.items.length }));

  return { allItems, feedErrors, counts };
}

module.exports = { fetchAllFeedItems };
