const crypto = require('node:crypto');
const TMDB_KEY = process.env.TMDB_API_KEY || '000802da6224e125437187b196cde898';
const SERVICES = ['Hulu','Prime Video','HBO Max','Netflix','Peacock','Paramount+','Disney+','Shudder'];
const serviceKey = name => {const n=String(name || '').toLowerCase().replace(/[^a-z0-9]/g,'');return ({amazonprimevideo:'primevideo',amazonprimevideowithads:'primevideo',max:'hbomax',peacockpremium:'peacock',paramountplus:'paramount',disneyplus:'disney',appletvplus:'appletv',netflixstandardwithads:'netflix'})[n] || n;};
const baseName = s => s.replace(/\s*(Amazon Channel|Apple TV Channel|Roku Premium Channel|Roku Channel)\s*$/i, '').trim();
async function tmdb(path) {
  const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Error(`TMDB ${res.status}`);
  return res.json();
}
function eventsFor(providers, dates, today = new Date().toISOString().slice(0,10), services = SERVICES) {
  const events = [];
  for (const kind of ['free','flatrate','ads','rent','buy']) {
    for (const p of providers[kind] || []) {
      const name = p.provider_name;
      const channel = /\b(channel|channels|add-on)\b/i.test(name);
      const mine = !channel && services.some(s=>serviceKey(s) === serviceKey(name));
      const label = ['free','ads'].includes(kind) ? `Free${kind === 'ads' ? ' with ads' : ''} on ${name}` : kind === 'flatrate' ? `${mine ? 'Included with' : 'Separate subscription:'} ${name}${channel ? ' (add-on channel)' : ''}` : `${kind === 'rent' ? 'Rent' : 'Buy'} on ${name}`;
      events.push({ key: `${kind}:${p.provider_id}`, label, link: providers.link || null });
    }
  }
  // A national release listing is not proof of a local showing.
  for (const r of dates.filter(r => [2,3,4].includes(r.type))) {
    const date = r.release_date.slice(0,10);
    const type = r.type === 4 ? 'Digital' : r.type === 2 ? 'US limited theatrical' : 'US theatrical';
    events.push({key:`date:${r.type}:${date}:${date <= today ? 'arrived' : 'scheduled'}`, label: `${type} ${date <= today ? 'release date reached' : 'scheduled'}: ${date}`, link: null});
  }
  return [...new Map(events.map(e => [e.key,e])).values()];
}
async function movieEvents(id, services = SERVICES) {
  const [p,d] = await Promise.all([tmdb(`/movie/${id}/watch/providers`),tmdb(`/movie/${id}/release_dates`)]);
  return eventsFor(p.results?.US || {}, d.results?.find(r => r.iso_3166_1 === 'US')?.release_dates || [],new Date().toISOString().slice(0,10),services);
}
function pendingEvents(events, seen = []) { const known = new Set(seen); return events.filter(e => !known.has(e.key)); }
const digestKey = events => crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports = { eventsFor, movieEvents, pendingEvents, digestKey, escapeHtml };
