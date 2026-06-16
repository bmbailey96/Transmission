// Structured sources are close to ground truth because the date is baked into
// machine-readable metadata, not extracted from someone's prose. Everything else
// is either a real article ("reported") or a single unconfirmed mention ("rumored").
const STRUCTURED_SOURCES = new Set(['musicbrainz', 'bandcamp', 'spotify', 'apple']);

function classifySource(sourceName, kindHint) {
  const normalized = (sourceName || '').toLowerCase();
  if (STRUCTURED_SOURCES.has(normalized)) return 'confirmed';
  if (kindHint === 'rumored') return 'rumored';
  return 'reported';
}

/**
 * observations: [{ source: string, date: 'YYYY-MM-DD', seenAt: ISOString, kind?: 'reported'|'rumored' }]
 *
 * Resolves to one best-guess date with an internal confidence tier. This tier is
 * never shown in the UI (auto-resolve quietly, per the design conversation), it's
 * just used internally to decide which date to trust when sources disagree.
 *
 * Resolution order: structured beats prose. Ties break on which date has more
 * independent corroborating sources, then on recency of the most recent sighting.
 */
function resolveDate(observations) {
  if (!observations || observations.length === 0) {
    return { date: null, tier: 'unknown', basis: 'no observations yet' };
  }

  const tiered = observations.map((o) => ({ ...o, tier: classifySource(o.source, o.kind) }));

  const confirmed = tiered.filter((o) => o.tier === 'confirmed');
  if (confirmed.length > 0) return pickBest(confirmed, 'confirmed');

  const reported = tiered.filter((o) => o.tier === 'reported');
  if (reported.length > 0) return pickBest(reported, 'reported');

  return pickBest(tiered, 'rumored');
}

function pickBest(candidates, tier) {
  const byDate = {};
  for (const c of candidates) {
    if (!byDate[c.date]) byDate[c.date] = { count: 0, mostRecentSeenAt: c.seenAt, sources: [] };
    byDate[c.date].count += 1;
    byDate[c.date].sources.push(c.source);
    if (new Date(c.seenAt) > new Date(byDate[c.date].mostRecentSeenAt)) {
      byDate[c.date].mostRecentSeenAt = c.seenAt;
    }
  }

  const ranked = Object.entries(byDate).sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count; // more corroboration wins
    return new Date(b[1].mostRecentSeenAt) - new Date(a[1].mostRecentSeenAt); // then most recent
  });

  const [bestDate, info] = ranked[0];
  return { date: bestDate, tier, basis: `${info.count} source(s): ${info.sources.join(', ')}` };
}

module.exports = { resolveDate, classifySource };
