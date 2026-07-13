const { getAllReleases } = require('../storage/releaseStore');

const TIMEZONE = 'America/Denver'; // Montana — used so "this week" means your week, not UTC's.
const SCORE_THRESHOLD = 55;

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

/** Returns today's date as YYYY-MM-DD in the given timezone, not UTC. */
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

/** Matches the site's own headline+reasoning combining logic exactly (fullTextFor in public/index.html). */
function combinedText(r) {
  const headline = (r.headline || '').trim();
  const reasoning = (r.reasoning || '').trim();
  if (headline && reasoning && reasoning !== headline) return `${headline} ${reasoning}`;
  return headline || reasoning || '';
}

// The site itself only shows 60 characters by default, with a "+" to expand.
// An email has no expand button, so this allows more room than that, but
// still nowhere near the full paragraph — the point of this pass was
// specifically to make 12 releases scannable in one scroll, not exhaustive.
const SNIPPET_MAX_CHARS = 160;

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 20) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}\u2026`;
}

/** Same 5-bar rounding the site uses (litBars in public/index.html). */
function litBars(score) {
  return Math.max(0, Math.min(5, Math.round((score / 100) * 5)));
}

const BAR_HEIGHTS = [5, 8, 11, 14, 17];

function meterHtml(score) {
  const lit = litBars(score);
  const bars = BAR_HEIGHTS.map((h, i) => {
    const isLit = i < lit;
    const bg = isLit ? COLORS.signal : COLORS.signalDim;
    return `<td style="width:4px;padding:0 1px;vertical-align:bottom;"><div style="width:4px;height:${h}px;border-radius:1px;background:${bg};"></div></td>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;vertical-align:middle;"><tr>${bars}</tr></table>`;
}

function evidenceLabel(level) {
  if (level === 'full') return 'FULL SIGNAL';
  if (level === 'partial') return 'PARTIAL SIGNAL';
  return 'NO SIGNAL';
}

function evidenceColor(level) {
  if (level === 'full') return COLORS.signal;
  if (level === 'partial') return COLORS.muted;
  return COLORS.warm;
}

function spotifySearchUrl(artist, albumTitle) {
  return `https://open.spotify.com/search/${encodeURIComponent(`${artist || ''} ${albumTitle || ''}`.trim())}`;
}

/**
 * Renders one release card matching the live site's layout: artwork, then
 * artist/album with the signal meter and score on the right, an
 * evidence-level line color-coded the same way the site does, the combined
 * headline+reasoning as one paragraph, optional standout-track chips, and a
 * source line whose meaning depends on section — a link back to wherever it
 * was discovered for upcoming releases, a Spotify search link for anything
 * already out (no direct album ID is persisted in storage to link to
 * directly, so search is the honest option here).
 */
function renderCard(r, { sourceMode }) {
  const evidence = ['full', 'partial', 'none'].includes(r.evidenceLevel) ? r.evidenceLevel : 'none';
  const text = escapeHtml(truncateText(combinedText(r), SNIPPET_MAX_CHARS));
  const artUrl = r.art && r.art.url ? escapeAttr(r.art.url) : null;

  const artCell = artUrl
    ? `<td style="width:64px;padding-right:14px;vertical-align:top;">
         <img src="${artUrl}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:6px;background:${COLORS.surface};" />
       </td>`
    : `<td style="width:64px;padding-right:14px;vertical-align:top;">
         <table role="presentation" width="64" height="64" cellpadding="0" cellspacing="0" style="border-radius:6px;background:${COLORS.surface};border:1px solid ${COLORS.hairline};">
           <tr><td align="center" style="font-family:${MONO};font-size:9px;color:${COLORS.dim};">no art</td></tr>
         </table>
       </td>`;

  const tracksChips =
    Array.isArray(r.standoutTracks) && r.standoutTracks.length
      ? `<p style="margin:7px 0 0;">${r.standoutTracks
          .map(
            (t) =>
              `<span style="display:inline-block;font-family:${MONO};font-size:11px;letter-spacing:0.02em;color:${COLORS.muted};border:1px solid ${COLORS.hairline};border-radius:3px;padding:1px 5px;margin:0 4px 4px 0;">${escapeHtml(t)}</span>`
          )
          .join('')}</p>`
      : '';

  let sourceLine = '';
  if (sourceMode === 'spotify') {
    sourceLine = `<p style="margin:10px 0 0;font-size:12px;font-family:${MONO};"><a href="${escapeAttr(
      spotifySearchUrl(r.artist, r.albumTitle)
    )}" style="color:${COLORS.signal};text-decoration:none;">FIND ON SPOTIFY &rarr;</a></p>`;
  } else if (r.link) {
    const label = r.sourceFeed ? `SOURCE // ${escapeHtml(r.sourceFeed).toUpperCase()}` : 'SOURCE';
    sourceLine = `<p style="margin:10px 0 0;font-size:12px;font-family:${MONO};"><a href="${escapeAttr(
      r.link
    )}" style="color:${COLORS.signal};text-decoration:none;">${label}</a></p>`;
  }

  return `
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.surface};border:1px solid ${COLORS.hairline};border-radius:4px;margin:0 0 12px;">
          <tr>
            <td style="padding:16px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${artCell}
                  <td style="vertical-align:top;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-family:${MONO};font-size:14px;font-weight:500;color:${COLORS.text};">
                          ${escapeHtml(r.artist || 'Unknown artist')}<span style="color:${COLORS.dim};margin:0 4px;">&mdash;</span><span style="color:${COLORS.muted};">${escapeHtml(r.albumTitle || 'Untitled')}</span>
                        </td>
                        <td align="right" style="white-space:nowrap;padding-left:10px;">
                          ${meterHtml(r.score)}
                          <span style="font-family:${MONO};font-size:12px;color:${COLORS.signal};padding-left:6px;">${r.score}%</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:4px 0 0;font-family:${MONO};font-size:10px;letter-spacing:0.07em;color:${evidenceColor(evidence)};">${evidenceLabel(evidence)}</p>
                    <p style="margin:2px 0 0;font-family:${MONO};font-size:11px;color:${COLORS.dim};">${formatDateLabel(r.releaseDate).toUpperCase()}</p>
                    ${tracksChips}
                    ${text ? `<p style="margin:9px 0 0;font-family:${FONT};font-size:13px;line-height:1.55;color:#c4c4c9;">${text}</p>` : ''}
                    ${sourceLine}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function sectionHtml(title, releases, sourceMode) {
  if (!releases.length) {
    return `
      <tr>
        <td style="padding:0 0 24px;">
          <p style="margin:0 0 10px;font-family:${MONO};font-size:12px;letter-spacing:0.08em;color:${COLORS.muted};text-transform:uppercase;">${title}</p>
          <p style="margin:0;font-family:${FONT};font-size:13px;color:${COLORS.dim};">Nothing scoring ${SCORE_THRESHOLD}%+ here this week.</p>
        </td>
      </tr>`;
  }
  const cards = releases.map((r) => renderCard(r, { sourceMode })).join('');
  return `
    <tr>
      <td style="padding:0 0 8px;">
        <p style="margin:0 0 10px;font-family:${MONO};font-size:12px;letter-spacing:0.08em;color:${COLORS.muted};text-transform:uppercase;">${title}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
      </td>
    </tr>`;
}

async function buildWeeklyDigest() {
  const today = todayInTimezone(TIMEZONE);
  const weekAgo = addDays(today, -6);
  const weekAhead = addDays(today, 6);

  const all = await getAllReleases();

  const lastWeek = all
    .filter(
      (r) =>
        r.category === 'already-released' &&
        r.releaseDate &&
        r.releaseDate >= weekAgo &&
        r.releaseDate <= today &&
        typeof r.score === 'number' &&
        r.score >= SCORE_THRESHOLD
    )
    .sort((a, b) => b.score - a.score);

  const thisWeek = all
    .filter(
      (r) =>
        r.category !== 'already-released' &&
        r.releaseDate &&
        r.releaseDate >= today &&
        r.releaseDate <= weekAhead &&
        typeof r.score === 'number' &&
        r.score >= SCORE_THRESHOLD
    )
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (a.releaseDate || '').localeCompare(b.releaseDate || '');
    });

  const rangeLabel = `${formatDateLabel(weekAgo)} – ${formatDateLabel(weekAhead)}`;
  const totalCount = lastWeek.length + thisWeek.length;

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionHtml('Last week, worth knowing about', lastWeek, 'spotify')}
      ${sectionHtml('Coming up this week', thisWeek, 'link')}
    </table>`;

  return {
    subject: `Transmission: ${totalCount} release${totalCount === 1 ? '' : 's'} ${SCORE_THRESHOLD}%+ (${rangeLabel})`,
    html: wrapShell(body, rangeLabel),
    count: totalCount,
  };
}

/** Wraps digest content in the site's actual visual shell. */
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
          <p style="margin:10px 0 0;font-family:${FONT};font-size:20px;font-weight:500;color:${COLORS.text};">Weekly signal</p>
          <p style="margin:2px 0 0;font-family:${MONO};font-size:12px;color:${COLORS.muted};">${rangeLabel}</p>
        </td>
      </tr>
      <tr><td>${innerHtml}</td></tr>
      <tr>
        <td style="padding:8px 4px 0;">
          <p style="margin:0;font-family:${MONO};font-size:11px;color:${COLORS.dim};letter-spacing:0.03em;">END OF TRANSMISSION</p>
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
