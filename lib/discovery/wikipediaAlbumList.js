const MONTH_NUM = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html) {
  if (!html) return '';
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

function parseDateCell(raw) {
  // Wikipedia's current renderer stamps an id="mwXXX" onto the <br> between
  // month and day too (e.g. "January<br id="mwLg"/>1"), so the old
  // /<br\s*\/?>/ pattern, which only allowed optional whitespace and an
  // optional slash before the closing >, stopped matching. Nothing got
  // replaced, "January" and "1" stayed jammed together with no whitespace
  // between them, and the month/day regex below (which requires \s+
  // between them) never matched, so this returned null for every date cell
  // on the page, silently, every time. Matching any attributes with
  // [^>]* instead of assuming the tag is bare fixes it the same way the
  // table/tr tag matching above did.
  const text = raw.replace(/<br\b[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2})/);
  if (!match) return null;
  const monthNum = MONTH_NUM[match[1]];
  if (!monthNum) return null;
  return { monthNum, day: match[2].padStart(2, '0') };
}

/**
 * True if an opening HTML tag's class attribute contains every one of the
 * given class names, regardless of order or what else is in the attribute.
 */
function tagHasClasses(tag, requiredClasses) {
  const classMatch = tag.match(/\bclass="([^"]*)"/);
  if (!classMatch) return false;
  const classes = classMatch[1].split(/\s+/);
  return requiredClasses.every((c) => classes.includes(c));
}

/**
 * Splits html on every opening <table ...> tag whose class attribute
 * contains all of requiredClasses, returning the html that follows each
 * matching tag (up to the next match, or end of string).
 *
 * Wikipedia's renderer stamps every <table>/<tr> with an id="mwXXX"
 * attribute now (Parsoid output), e.g. <table class="wikitable
 * plainrowheaders" id="mwBvI">. This used to be an exact-literal
 * `html.split('<table class="wikitable plainrowheaders">')`, which matched
 * fine when the tag had no other attributes but silently matches nothing
 * now that an id is always present, so this returned zero entries on every
 * run without ever throwing, since res.ok was still true and the page
 * fetched fine, just parsed empty. Matching on the class attribute instead
 * of the whole literal tag is tolerant of whatever else Wikipedia puts
 * inside the tag.
 */
function splitOnMatchingTables(html, requiredClasses) {
  const tagRe = /<table\b[^>]*>/g;
  const chunks = [];
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    if (tagHasClasses(match[0], requiredClasses)) {
      chunks.push(html.slice(match.index + match[0].length));
    }
  }
  return chunks;
}

/**
 * Same id-attribute problem applies to <tr>: real rows come through as
 * <tr id="mwXXX"> now, not bare <tr>, so the old exact `.split('<tr>')`
 * only ever caught the handful of unrelated rows (nav/sidebar tables
 * elsewhere on the page) that happen to have no id, and dropped nearly
 * every actual data row.
 */
function splitOnTableRows(tableHtml) {
  return tableHtml.split(/<tr\b[^>]*>/).slice(1);
}

/**
 * Pulls Wikipedia's running "List of <year> albums" page. Unlike RSS sources,
 * entries here persist by release date rather than scrolling out of view, so
 * this catches things announced well before this app started watching.
 */
async function fetchUpcomingAlbums(year = new Date().getFullYear()) {
  const url = `https://en.wikipedia.org/wiki/List_of_${year}_albums`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch Wikipedia album list: ${res.status}`);
  const html = await res.text();

  const tableChunks = splitOnMatchingTables(html, ['wikitable', 'plainrowheaders']);
  const entries = [];

  for (const chunk of tableChunks) {
    const tableHtml = chunk.split('</table>')[0];
    const rows = splitOnTableRows(tableHtml);

    let currentDate = null;

    for (const rowHtml of rows) {
      const row = rowHtml.split('</tr>')[0];

      if (row.includes('colspan=') || row.includes('<th scope="col"')) continue;

      let remaining = row;
      const thMatch = remaining.match(/<th[^>]*>([\s\S]*?)<\/th>/);
      if (thMatch) {
        const parsed = parseDateCell(thMatch[1]);
        if (parsed) currentDate = parsed;
        remaining = remaining.slice(thMatch.index + thMatch[0].length);
      }

      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let m;
      while ((m = cellRe.exec(remaining)) !== null) cells.push(m[1]);

      if (cells.length < 2 || !currentDate) continue;

      const artist = stripTags(cells[0]);
      const albumTitle = stripTags(cells[1]);
      const label = cells[3] ? stripTags(cells[3]) : '';

      if (!artist || !albumTitle || /^Template:/i.test(albumTitle)) continue;

      entries.push({
        artist,
        albumTitle,
        releaseDate: `${year}-${currentDate.monthNum}-${currentDate.day}`,
        label,
        sourceFeed: 'Wikipedia album list',
      });
    }
  }

  return entries;
}

module.exports = { fetchUpcomingAlbums };