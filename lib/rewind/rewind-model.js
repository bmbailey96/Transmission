(function(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.RewindModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_SERVICES = ['Netflix','Hulu','Prime Video','HBO Max','Disney+','Peacock','Paramount+','Shudder'];
  const SERVICE_CHOICES = [...DEFAULT_SERVICES,'Apple TV+','MUBI','Criterion Channel','AMC+','Starz','Eternal Family'];
  function serviceKey(name) {
    const key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g,'');
    return ({amazonprimevideo:'primevideo',amazonprime:'primevideo',max:'hbomax',peacockpremium:'peacock',amazonprimevideowithads:'primevideo',netflixstandardwithads:'netflix',netflixbasicwithads:'netflix',disneyplus:'disney',disney:'disney',paramountplus:'paramount',paramount:'paramount',appletvplus:'appletv',amazonvideo:'amazonstore',appletvstore:'applestore',itunes:'applestore',vudu:'fandangoathome'})[key] || key;
  }
  function isChannel(name) { return /\b(channel|channels|addon|add-on)\b/i.test(name || ''); }
  function included(name, services = DEFAULT_SERVICES) { return !isChannel(name) && services.some(s => serviceKey(s) === serviceKey(name)); }
  function safeLink(value) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } }
  function normalizeTMDB(providers = {}, services = DEFAULT_SERVICES) {
    return ['flatrate','free','ads','rent','buy'].flatMap(type => (providers[type] || []).map(p => ({
      provider: p.provider_name, kind: type === 'flatrate' ? 'subscription' : type === 'ads' ? 'free' : type,
      included: type === 'flatrate' && included(p.provider_name,services), channel:isChannel(p.provider_name),
      adSupported:type === 'ads', price:null, format:null, region:'US', source:'JustWatch / TMDB',
      link:safeLink(providers.link), logo:p.logo_path || null,
    })));
  }
  function normalizeWatchmode(sources, services = DEFAULT_SERVICES) {
    return (Array.isArray(sources) ? sources : []).filter(s => s.region === 'US' && ['sub','free','rent','buy','tve'].includes(s.type)).map(s => ({
      provider:s.name,kind:s.type === 'sub' ? 'subscription' : s.type === 'tve' ? 'cable' : s.type,
      included:s.type === 'sub' && included(s.name,services),channel:isChannel(s.name),adSupported:s.type === 'free',
      price:['rent','buy'].includes(s.type) && typeof s.price === 'number' && Number.isFinite(s.price) && s.price >= 0 ? s.price : null,
      format:s.format || null,region:'US',source:'Watchmode',link:safeLink(s.web_url),logo:null,
    }));
  }
  function mergeOffers(tmdb, watchmode) {
    const identity = o => {
      let key=serviceKey(o.provider);
      if (['rent','buy'].includes(o.kind)) {if (['appletv','applestore'].includes(key)) key='applestore';if (['amazon','amazonstore','primevideo'].includes(key)) key='amazonstore';}
      return `${o.kind}:${key}:${o.channel ? 'channel' : 'direct'}`;
    };
    const wmKeys = new Set(watchmode.map(identity));
    const all = [...tmdb.filter(o=>!wmKeys.has(identity(o))),...watchmode];
    return [...new Map(all.map(o=>[`${identity(o)}:${o.format || ''}:${o.price ?? ''}`,o])).values()];
  }
  function summary(offers) {
    const mine = offers.filter(o=>o.kind === 'subscription' && o.included);
    if (mine.length) return {code:'free',kind:'included',label:`Included with ${[...new Set(mine.map(o=>o.provider))].join(' · ')}`};
    const free = offers.filter(o=>o.kind === 'free');
    if (free.length) return {code:'free',kind:'free',label:`Free on ${[...new Set(free.map(o=>o.provider))].join(' · ')}`};
    const rent = offers.filter(o=>o.kind === 'rent');
    if (rent.length) {
      const quoted = rent.filter(o=>o.price !== null).sort((a,b)=>a.price-b.price)[0];
      return {code:'rent',kind:'rent',label:quoted ? `Rent from $${quoted.price.toFixed(2)}${quoted.format ? ` (${quoted.format})` : ''}` : 'Available to rent · price not supplied'};
    }
    const buy = offers.filter(o=>o.kind === 'buy');
    if (buy.length) return {code:'rent',kind:'buy',label:'Available to buy · no rental listed'};
    const other = offers.filter(o=>o.kind === 'subscription');
    if (other.length) return {code:'rent',kind:'subscription',label:`Separate subscription: ${[...new Set(other.map(o=>o.provider))].join(' · ')}`};
    if (offers.some(o=>o.kind === 'cable')) return {code:'rent',kind:'cable',label:'Cable login required'};
    return null;
  }
  function usTheatricalDates(details) {
    const dates = details.release_dates?.results?.find(r=>r.iso_3166_1 === 'US')?.release_dates || [];
    const wide=dates.filter(r=>r.type===3).map(r=>r.release_date.slice(0,10)).sort();
    return wide.length ? wide : dates.filter(r=>r.type===2).map(r=>r.release_date.slice(0,10)).sort();
  }
  function discoveryMovie(movie, details, window, includeRereleases = false) {
    if (!details || details.runtime < 60 || !details.runtime || !movie.poster_path) return null;
    const dates = usTheatricalDates(details);
    const date = includeRereleases ? dates.find(d=>d >= window.start && d <= window.end) : dates[0];
    if (!date || date < window.start || date > window.end || date > window.today) return null;
    const directors = (details.credits?.crew || []).filter(c=>c.job === 'Director').map(c=>c.name);
    return {...movie,overview:details.overview || movie.overview || '',runtime:details.runtime,director:directors.join(', '),usReleaseDate:date,genre_ids:movie.genre_ids || (details.genres || []).map(g=>g.id)};
  }
  return {DEFAULT_SERVICES,SERVICE_CHOICES,serviceKey,isChannel,included,safeLink,normalizeTMDB,normalizeWatchmode,mergeOffers,summary,usTheatricalDates,discoveryMovie};
});
