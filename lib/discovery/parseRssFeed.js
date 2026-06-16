function extractTag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`);
  const match = block.match(re);
  if (!match) return null;
  let value = match[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) value = cdata[1];
  return value.trim();
}

/**
 * Fetches a standard RSS 2.0 feed and returns parsed items.
 * Handles the common WordPress-style shape (title, link, pubDate, description,
 * content:encoded, all optionally CDATA-wrapped) without needing an XML library.
 */
async function parseRssFeed(feedUrl) {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`Failed to fetch feed ${feedUrl}: ${res.status}`);
  const xml = await res.text();

  const rawItems = xml.split('<item>').slice(1).map((chunk) => chunk.split('</item>')[0]);

  return rawItems.map((block) => ({
    title: extractTag(block, 'title'),
    link: extractTag(block, 'link'),
    pubDate: extractTag(block, 'pubDate'),
    description: extractTag(block, 'description'),
    content: extractTag(block, 'content:encoded'),
    guid: extractTag(block, 'guid'),
  }));
}

module.exports = { parseRssFeed };
