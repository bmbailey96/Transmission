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

const COLORS = {
  bg: '#0b0b0d',
  surface: '#15151a',
  hairline: '#232328',
  text: '#ececef',
  muted: '#75757d',
  dim: '#4c4c52',
  signal: '#7fe7c4',
  signalDim: '#2c4b42',
  warm: '#ff8c5a',
};
const FONT = "'Space Grotesk', -apple-system, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SCORE_THRESHOLD = 60;

async function buildWeeklyDigest() {
  const start = todayInTimezone(TIMEZONE);
  const end = addDays(start, 6);

  const all = await getAllReleases();
  const thisWeek = all
    .filter(
      (r) =>
        r.releaseDate &&
        r.releaseDate >= start &&
        r.releaseDate <= end &&
        typeof r.score === 'number' &&
        r.score >= SCORE_THRESHOLD
    )
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (a.releaseDate || '').localeCompare(b.releaseDate || '');
    });

  const rangeLabel = `${formatDateLabel(start)} – ${formatDateLabel(end)}`;

  if (thisWeek.length === 0) {
    return {
      subject: `Transmission: nothing ${SCORE_THRESHOLD}%+ this week (${rangeLabel})`,
      html: wrapShell(
        `<p style="color:${COLORS.muted};font-family:${FONT};">Nothing scoring ${SCORE_THRESHOLD}% or higher is releasing between ${rangeLabel}. Quiet week.</p>`,
        rangeLabel
      ),
      count: 0,
    };
  }

  const cards = thisWeek
    .map((r) => {
      const headline = r.headline ? escapeHtml(r.headline) : '';
      const reasoning = r.reasoning ? escapeHtml(r.reasoning) : '';
      const sourceLine =
        r.link && r.sourceFeed
          ? `<p style="margin:10px 0 0;font-size:12px;font-family:${MONO};"><a href="${escapeAttr(r.link)}" style="color:${COLORS.signal};text-decoration:none;">SOURCE // ${escapeHtml(r.sourceFeed).toUpperCase()}</a></p>`
          : r.link
            ? `<p style="margin:10px 0 0;font-size:12px;font-family:${MONO};"><a href="${escapeAttr(r.link)}" style="color:${COLORS.signal};text-decoration:none;">SOURCE</a></p>`
            : '';

      return `
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.surface};border:1px solid ${COLORS.hairline};border-radius:4px;margin:0 0 12px;">
              <tr>
                <td style="padding:18px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-family:${FONT};font-size:16px;font-weight:500;color:${COLORS.text};">
                        ${escapeHtml(r.artist || 'Unknown artist')} <span style="color:${COLORS.muted};">—</span> ${escapeHtml(r.albumTitle || 'Untitled')}
                      </td>
                      <td align="right" style="font-family:${MONO};font-size:14px;font-weight:700;color:${COLORS.signal};white-space:nowrap;padding-left:12px;">
                        ${r.score}%
                      </td>
                    </tr>
                  </table>
                  <p style="margin:4px 0 0;font-family:${MONO};font-size:11px;letter-spacing:0.03em;color:${COLORS.muted};text-transform:uppercase;">${formatDateLabel(r.releaseDate)}</p>
                  ${headline ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:14px;font-weight:500;color:${COLORS.warm};">${headline}</p>` : ''}
                  ${reasoning ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${COLORS.text};">${reasoning}</p>` : ''}
                  ${sourceLine}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join('');

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${cards}
    </table>`;

  return {
    subject: `Transmission: ${thisWeek.length} release${thisWeek.length === 1 ? '' : 's'} ${SCORE_THRESHOLD}%+ this week (${rangeLabel})`,
    html: wrapShell(body, rangeLabel),
    count: thisWeek.length,
  };
}

/**
 * Wraps digest content in the site's actual visual shell — dark background,
 * mint "signal" accent, monospace labels — so the email reads as the same
 * thing as the app rather than a generic table dropped in your inbox.
 */
function wrapShell(innerHtml, rangeLabel) {
  return `
  <div style="background:${COLORS.bg};padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
      <tr>
        <td style="padding:0 4px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:10px;height:10px;border-radius:50%;background:${COLORS.signal};box-shadow:0 0 6px ${COLORS.signal};"></td>
              <td style="padding-left:10px;font-family:${MONO};font-size:13px;letter-spacing:0.08em;color:${COLORS.signal};text-transform:uppercase;">TRANSMISSION</td>
            </tr>
          </table>
          <p style="margin:10px 0 0;font-family:${FONT};font-size:20px;font-weight:500;color:${COLORS.text};">This week's signal</p>
          <p style="margin:2px 0 0;font-family:${MONO};font-size:12px;color:${COLORS.muted};">${rangeLabel}</p>
        </td>
      </tr>
      <tr><td>${innerHtml}</td></tr>
      <tr>
        <td style="padding:20px 4px 0;">
          <p style="margin:0;font-family:${MONO};font-size:11px;color:${COLORS.dim || COLORS.muted};letter-spacing:0.03em;">END OF TRANSMISSION</p>
        </td>
      </tr>
    </table>
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

module.exports = { buildWeeklyDigest, todayInTimezone, addDays };
