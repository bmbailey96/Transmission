const { getAllReleases } = require('../storage/releaseStore');

const TIMEZONE = 'America/Denver'; // Montana — used so "this week" means your week, not UTC's.

/**
 * Returns today's date as YYYY-MM-DD in the given timezone, not UTC.
 * Matters here specifically because releaseDate strings are plain calendar
 * dates with no time component, so comparing against a UTC "today" could be
 * off by a day depending on time of night this runs.
 */
function todayInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function buildWeeklyDigest() {
  const start = todayInTimezone(TIMEZONE);
  const end = addDays(start, 6);

  const all = await getAllReleases();
  const thisWeek = all
    .filter((r) => r.releaseDate && r.releaseDate >= start && r.releaseDate <= end)
    .sort((a, b) => {
      const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.releaseDate || '').localeCompare(b.releaseDate || '');
    });

  const rangeLabel = `${formatDateLabel(start)} – ${formatDateLabel(end)}`;

  if (thisWeek.length === 0) {
    return {
      subject: `Transmission: nothing on your radar this week (${rangeLabel})`,
      html: `<p>Nothing scored is releasing between ${rangeLabel}. Quiet week.</p>`,
      count: 0,
    };
  }

  const rows = thisWeek
    .map((r) => {
      const scoreLabel = typeof r.score === 'number' ? `${r.score}%` : 'unscored';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <strong>${escapeHtml(r.artist || 'Unknown artist')}</strong> — ${escapeHtml(r.albumTitle || 'Untitled')}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;">${formatDateLabel(r.releaseDate)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;">${scoreLabel}</td>
        </tr>`;
    })
    .join('');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">This week's releases</h2>
      <p style="color:#666;margin-top:0;">${rangeLabel}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="text-align:left;">
            <th style="padding:8px 12px;border-bottom:2px solid #333;">Album</th>
            <th style="padding:8px 12px;border-bottom:2px solid #333;">Date</th>
            <th style="padding:8px 12px;border-bottom:2px solid #333;">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return {
    subject: `Transmission: ${thisWeek.length} release${thisWeek.length === 1 ? '' : 's'} this week (${rangeLabel})`,
    html,
    count: thisWeek.length,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { buildWeeklyDigest, todayInTimezone, addDays };
