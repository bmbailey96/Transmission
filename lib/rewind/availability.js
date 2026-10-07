const crypto=require('node:crypto');
const Model=require('./rewind-model');
const Release=require('./release-model');
const feed=require('./announcements.json');
const TMDB_KEY=process.env.TMDB_API_KEY||'000802da6224e125437187b196cde898';
const todayUS=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function tmdb(path){const res=await fetch(`https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}`,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error(`TMDB ${res.status}`);return res.json();}
function eventsFor(providers,dates,today=todayUS(),services=Model.DEFAULT_SERVICES){
  const events=[];
  for(const kind of ['free','flatrate','ads','rent','buy'])for(const p of providers[kind]||[]){const name=p.provider_name;const channel=Model.isChannel(name),mine=Model.included(name,services);const label=['free','ads'].includes(kind)?`Free${kind==='ads'?' with ads':''} on ${name}`:kind==='flatrate'?`${mine?'Included with':'Separate subscription:'} ${name}${channel?' (add-on channel)':''}`:`${kind==='rent'?'Rent':'Buy'} on ${name}`;events.push({key:`${kind}:${p.provider_id}`,label,link:providers.link||null,kind:kind==='flatrate'?'subscription':['free','ads'].includes(kind)?'free':kind,provider:name,included:kind==='flatrate'&&mine});}
  for(const r of dates.filter(r=>[2,3,4].includes(r.type))){const date=Release.date(r.release_date);if(!date)continue;const type=r.type===4?'Digital':r.type===2?'US limited theatrical':'US theatrical';events.push({key:`date:${r.type}:${date}:${date<=today?'arrived':'scheduled'}`,label:`${type} ${date<=today?'release date reached':'scheduled'}: ${date}`,link:null,kind:r.type===4?'digital':'theatrical',date});}
  return [...new Map(events.map(e=>[e.key,e])).values()];
}
function announcementEvents(id,services=Model.DEFAULT_SERVICES,today=todayUS()){
 return Release.matchingAnnouncements({...feed,today},id).map(a=>({key:`announcement:${a.kind}:${Model.serviceKey(a.provider)}:${a.date||'tba'}:${a.date&&a.date<=today?'arrived':'scheduled'}`,kind:a.kind,provider:a.provider,included:a.kind==='subscription'&&Model.included(a.provider,services),date:a.date,price:a.price,label:a.kind==='subscription'?`${a.provider} ${a.date&&a.date<=today?'announced date reached (verify current availability)':'announced'}: ${a.date||'date to be confirmed'}`:`${a.kind} announced: ${a.date||'date to be confirmed'}`,link:a.sourceUrl}));
}
let calendarPromise=null,calendarCache=null;
async function upcomingCalendar(){
 if(!process.env.WATCHMODE_API_KEY)return [];
 if(calendarCache&&Date.now()-calendarCache.checkedAt<24*3600000)return calendarCache.rows;
 if(!calendarPromise){const today=todayUS(),start=Release.addDays(today,-30).replaceAll('-',''),end=Release.addDays(today,90).replaceAll('-','');calendarPromise=fetch(`https://api.watchmode.com/v1/releases/?start_date=${start}&end_date=${end}&limit=250`,{headers:{'X-API-Key':process.env.WATCHMODE_API_KEY},signal:AbortSignal.timeout(15000)}).then(async res=>{if(!res.ok)throw Error('Upcoming calendar unavailable');const body=await res.json();const rows=Array.isArray(body.releases)?body.releases:[];calendarCache={checkedAt:Date.now(),rows};return rows;}).finally(()=>calendarPromise=null);}
 return calendarPromise;
}
async function movieEvents(id,services=Model.DEFAULT_SERVICES,priceOptions){
 const [p,d]=await Promise.all([tmdb(`/movie/${id}/watch/providers`),tmdb(`/movie/${id}/release_dates`)]);
 const today=todayUS();const events=eventsFor(p.results?.US||{},d.results?.find(r=>r.iso_3166_1==='US')?.release_dates||[],today,services);
 events.push(...announcementEvents(id,services,today));
 try{const quote=await require('./prices').lookupPrices(id,priceOptions);for(const o of quote.offers){if(o.kind==='rent')events.push({key:`quote:rent:${Model.serviceKey(o.provider)}:${o.format||''}:${o.price}`,kind:'rent',provider:o.provider,price:o.price,format:o.format,link:o.link,source:quote.source,checkedAt:quote.checkedAt,label:`Rent for $${o.price.toFixed(2)} on ${o.provider}${o.format?' ('+o.format+')':''}`});}}
 catch(err){console.error(`Rewind store prices ${id}: ${err.message}`);}

 if(process.env.WATCHMODE_API_KEY){
  // Optional price/calendar failures do not turn into empty availability.
  try{const res=await fetch(`https://api.watchmode.com/v1/title/movie-${id}/sources/?regions=US`,{headers:{'X-API-Key':process.env.WATCHMODE_API_KEY},signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error(`Price lookup ${res.status}`);const raw=await res.json();if(!Array.isArray(raw))throw Error('Invalid quote response');for(const offer of Model.normalizeWatchmode(raw,services)){if(offer.kind==='rent'&&offer.price!==null)events.push({key:`quote:rent:${Model.serviceKey(offer.provider)}:${offer.format||''}:${offer.price}`,kind:'rent',provider:offer.provider,price:offer.price,format:offer.format,link:offer.link,label:`Rent for $${offer.price.toFixed(2)} on ${offer.provider}${offer.format?' ('+offer.format+')':''}`});}}
  catch(err){console.error(`Rewind quotes ${id}: ${err.message}`);}
  try{for(const r of await upcomingCalendar()){if(r.tmdb_id!==id||r.tmdb_type!=='movie'||r.region&&r.region!=='US'||!Release.date(r.source_release_date)||!Model.SERVICE_CHOICES.some(s=>Model.serviceKey(s)===Model.serviceKey(r.source_name)))continue;const date=r.source_release_date;events.push({key:`calendar:${r.source_id}:${date}:${date<=today?'arrived':'scheduled'}`,kind:'subscription',provider:r.source_name,included:Model.included(r.source_name,services),date,label:`${r.source_name} calendar ${date<=today?'date reached (verify current US availability)':'release listed'}: ${date}`,link:'https://api.watchmode.com/docs'});}}
  catch(err){console.error(`Rewind calendar: ${err.message}`);}
 }
 return [...new Map(events.map(e=>[e.key,e])).values()];
}
function eligibleEvents(events,raw){const pref=Release.preference(raw);if(pref.mode==='any')return events;if(pref.mode==='mine')return events.filter(e=>e.kind==='free'||e.kind==='subscription'&&e.included);return events.filter(e=>e.kind==='rent'&&typeof e.price==='number'&&Number.isFinite(e.price)&&e.price<=pref.maxPrice);}
function pendingEvents(events,seen=[]){const known=new Set(seen);return events.filter(e=>!known.has(e.key));}
const digestKey=events=>crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports={eventsFor,movieEvents,pendingEvents,digestKey,escapeHtml,eligibleEvents,announcementEvents};
