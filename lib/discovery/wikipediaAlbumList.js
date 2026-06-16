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
  const text = raw.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2})/);
  if (!match) return null;
  const monthNum = MONTH_NUM[match[1]];
  if (!monthNum) return null;
  return { monthNum, day: match[2].padStart(2, '0') };
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

  const tableChunks = html.split('<table class="wikitable plainrowheaders">').slice(1);
  const entries = [];

  for (const chunk of tableChunks) {
    const tableHtml = chunk.split('</table>')[0];
    const rows = tableHtml.split('<tr>').slice(1);

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
