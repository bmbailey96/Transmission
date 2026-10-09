const cheerio = require('cheerio');
const FATHOM_URL = 'https://www.fathomentertainment.com/releases/';
const LOCAL_URL = 'https://www.tributemovies.com/cinema/Montana/Kalispell/Cinemark-Signature-Stadium-Kalispell-14/10338/';
const LOCAL_SERVICE_URL = 'https://kalispell-showtimes.onrender.com/api/showtimes?days=120';
const CINEMARK_URL = 'https://www.cinemark.com/theatres/mt-kalispell/cinemark-signature-stadium-kalispell-14';
const months = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function todayDenver(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function iso(month,day,year){const d=new Date(Date.UTC(year,month-1,day));return d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;}
function inferredDate(month,day,today,year){if(year)return iso(month,day,Number(year));const y=Number(today.slice(0,4));return [y-1,y,y+1].map(v=>iso(month,day,v)).filter(Boolean).sort((a,b)=>{const score=x=>{const days=(Date.parse(x)-Date.parse(today))/86400000;return (days< -60||days>300?10000:0)+Math.abs(days);};return score(a)-score(b);})[0];}
function safeURL(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&hosts.includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function parseFathom(html,today=todayDenver()){
 const $=cheerio.load(html),events=[];
 $('a.posters-item').each((_,el)=>{const a=$(el),url=safeURL(a.attr('href'),['www.fathomentertainment.com']),title=a.find('h3.headline').text().trim();if(!url||!title)return;
  const labels=a.find('.date-list span').toArray().map(e=>$(e).text().trim());const ranges=[],dates=[];
  for(const label of labels){const parts=[...label.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(20\d{2}))?/g)].map(m=>inferredDate(months[m[1]],Number(m[2]),today,m[3])).filter(Boolean);if(/[—–]/.test(label)&&parts.length===2)ranges.push({start:parts[0],end:parts[1]});else dates.push(...parts);}
  const all=[...dates,...ranges.flatMap(r=>[r.start,r.end])].sort();if(!all.length||all.at(-1)<today)return;
  events.push({id:a.attr('id')||url,title,category:a.find('.preheadline').text().trim()||'Fathom event',url,poster:safeURL(a.find('img').attr('src'),['media.fathomentertainment.com']),dates:[...new Set(dates)].sort(),ranges,start:all[0],end:all.at(-1),dateLabel:labels.join(' · '),scope:'national',source:'Fathom Entertainment',checkedAt:Date.now()});
 });if(!events.length&&!$('a.posters-item').length)throw Error('Fathom calendar layout could not be read.');return events;
}
function parseLocal(html,today=todayDenver()){
 const $=cheerio.load(html),movies=[];
 $('li.movie-info-box').each((_,el)=>{const item=$(el),title=item.find('h2.media-heading').text().trim();if(!title)return;const screenings=[];
 item.find('.ticketicons').each((_,box)=>{let date=null;const format=$(box).find('h3').text().trim();$(box).children().each((_,child)=>{const c=$(child);if(child.tagName==='b'){const m=c.text().match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\w{3})\s+(\d{1,2})/);date=m&&months[m[1]]?inferredDate(months[m[1]],Number(m[2]),today):null;}else if(child.tagName==='a'&&date&&date>=today){const time=c.find('button').text().trim();const url=safeURL(c.attr('href'),['tickets.fandango.com','www.fandango.com','www.cinemark.com']);if(time&&/^\d{1,2}:\d{2}\s*[ap]m$/i.test(time)&&url)screenings.push({date,time,format,url});}});});
 const unique=[...new Map(screenings.map(s=>[s.date+'|'+s.time+'|'+s.format,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));if(unique.length)movies.push({id:'local:'+title.toLowerCase().replace(/[^a-z0-9]/g,''),title,screenings:unique,dates:[...new Set(unique.map(s=>s.date))],start:unique[0].date,end:unique.at(-1).date,scope:'local',source:'TributeMovies / Fandango',url:CINEMARK_URL,checkedAt:Date.now()});
 });if(!movies.length&&!$('li.movie-info-box').length)throw Error('Kalispell listings layout could not be read.');return movies;
}
function parseCinemark(html,today=todayDenver(),requestedDate=today){
 const $=cheerio.load(html),schemas=[];const scripts=$('script').toArray();
 for(const el of scripts){const content=$(el).text();if($(el).attr('type')==='application/ld+json'){try{schemas.push(JSON.parse(content));}catch{}}}
 // Cinemark also sends the JSON-LD graph as a Next flight text record. Decode
 // the published JSON bytes, without evaluating page scripts.
 const chunks=[];for(const el of scripts){const m=$(el).text().match(/^self\.__next_f\.push\(([\s\S]+)\);?$/);if(m)try{const payload=JSON.parse(m[1]);if(typeof payload[1]==='string')chunks.push(payload[1]);}catch{}}
 const flight=chunks.join('');for(const m of flight.matchAll(/(?:^|\n)[a-f0-9]+:T([a-f0-9]+),\{"@context":/g)){const start=m.index+m[0].indexOf('{'),length=parseInt(m[1],16);if(length>1000000)continue;try{schemas.push(JSON.parse(Buffer.from(flight.slice(start)).subarray(0,length).toString('utf8')));}catch{}}
 const graph=schemas.flatMap(s=>s['@graph']||[]),theater=graph.find(o=>o['@type']==='MovieTheater'&&o['@id']===CINEMARK_URL+'#theater');if(!theater)throw Error('Official Kalispell schema unavailable');
 const movies=new Map(graph.filter(o=>o['@type']==='Movie').map(o=>[o['@id'],o])),grouped=new Map(),covered=new Set([requestedDate]);
 for(const event of graph.filter(o=>o['@type']==='ScreeningEvent'&&o.location?.['@id']===theater['@id'])){
  if(event.eventStatus&&event.eventStatus!=='https://schema.org/EventScheduled')continue;const instant=new Date(event.startDate);if(!Number.isFinite(instant.getTime())||!/(?:Z|[+-]\d{2}:\d{2})$/.test(event.startDate))continue;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);if(date<today)continue;const movie=movies.get(event.workPresented?.['@id']),url=safeURL(event.offers?.url,['www.cinemark.com','cinemark.com']);if(!movie?.name||!url)continue;
  covered.add(date);const title=movie.name,id='local:'+title.toLowerCase().replace(/[^a-z0-9]/g,''),time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit',hour12:true}).format(instant).replace(/\s/g,'').toLowerCase();
  if(!grouped.has(id))grouped.set(id,{id,title,poster:safeURL(movie.image,['www.cinemark.com','cinemark.com']),screenings:[],scope:'local',source:'Cinemark official listings',url:CINEMARK_URL,checkedAt:Date.now()});grouped.get(id).screenings.push({date,time,startsAt:instant.toISOString(),format:event.videoFormat||'Standard',url,source:'Cinemark'});
 }
 const items=[...grouped.values()].map(m=>{const screenings=[...new Map(m.screenings.map(s=>[s.date+'|'+s.time+'|'+s.format,s])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)),dates=[...new Set(screenings.map(s=>s.date))].sort();return {...m,screenings,dates,start:dates[0],end:dates.at(-1)};});items.coveredDates=[...covered];return items;
}
function mergeLocal(official,secondary){const map=new Map(official.map(m=>[m.id,m])),covered=new Set(official.coveredDates||[]);for(const item of secondary||[]){const screenings=(item.screenings||[]).filter(s=>!covered.has(s.date)),dates=item.dates.filter(d=>!covered.has(d));if(!dates.length)continue;const old=map.get(item.id);const mergedDates=[...new Set([...(old?.dates||[]),...dates])].sort();map.set(item.id,{...item,...old,dates:mergedDates,screenings:[...(old?.screenings||[]),...screenings],start:mergedDates[0],end:mergedDates.at(-1)});}return [...map.values()];}
async function fetchHTML(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'Accept':'text/html','User-Agent':'Rewind-film-calendar/1.0'}});if(!r.ok)throw Error('Source returned HTTP '+r.status);return r.text();}
function normalizeLocalService(body,today=todayDenver()){
 if(body.error||!Array.isArray(body.movies)||!Number.isFinite(Date.parse(body.generated_at)))throw Error('Existing Kalispell service returned no verified calendar.');
 const checkedAt=Date.parse(body.generated_at);if(checkedAt>Date.now()+5*60000||Date.now()-checkedAt>86400000)throw Error('Existing Kalispell calendar is too old.');
 const items=body.movies.filter(m=>typeof m.title==='string').map(m=>{const dates=[...new Set((m.dates||[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&iso(Number(d.slice(5,7)),Number(d.slice(8)),Number(d.slice(0,4)))===d&&d>=today))].sort();return {id:'local:'+m.title.toLowerCase().replace(/[^a-z0-9]/g,''),title:m.title,dates,start:dates[0],end:dates.at(-1),screenings:[],scope:'local',source:'Kalispell Showtimes / TributeMovies',url:CINEMARK_URL,checkedAt};}).filter(m=>m.dates.length);items.checkedAt=checkedAt;return items;
}
async function existingLocal(today){const r=await fetch(LOCAL_SERVICE_URL,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Existing Kalispell service HTTP '+r.status);return normalizeLocalService(await r.json(),today);}
function combineOfficial(batches){const map=new Map(),covered=new Set();for(const items of batches){for(const day of items.coveredDates||[])covered.add(day);for(const item of items){const old=map.get(item.id),screenings=[...new Map([...(old?.screenings||[]),...item.screenings].map(s=>[s.date+'|'+s.time+'|'+s.format,s])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)),dates=[...new Set(screenings.map(s=>s.date))].sort();map.set(item.id,{...old,...item,screenings,dates,start:dates[0],end:dates.at(-1)});}}const out=[...map.values()];out.coveredDates=[...covered];return out;}
async function officialWeek(today){const days=Array.from({length:7},(_,i)=>new Date(Date.parse(today+'T12:00:00Z')+i*86400000).toISOString().slice(0,10)),checks=await Promise.allSettled(days.map(day=>fetchHTML(CINEMARK_URL+'?showDate='+day).then(h=>parseCinemark(h,today,day)))),batches=checks.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!batches.length)throw Error('Official Kalispell week unavailable');return combineOfficial(batches);}
async function refreshCinema(previous){
 const today=todayDenver();const [fathom,official,direct]=await Promise.allSettled([fetchHTML(FATHOM_URL).then(h=>parseFathom(h,today)),officialWeek(today),fetchHTML(LOCAL_URL).then(h=>parseLocal(h,today))]);
 let local=official.status==='fulfilled'?{status:'fulfilled',value:mergeLocal(official.value,direct.status==='fulfilled'?direct.value:[])}:direct,sourceURL=official.status==='fulfilled'?CINEMARK_URL:LOCAL_URL;
 if(local.status!=='fulfilled'){sourceURL=LOCAL_SERVICE_URL;try{local={status:'fulfilled',value:await existingLocal(today)};}catch(error){local={status:'rejected',reason:error};}}
 const result={schema:2,generatedAt:Date.now(),today,theatre:'Cinemark Signature Stadium Kalispell 14',theatreURL:CINEMARK_URL};
 for(const [key,check,url,ttl] of [['events',fathom,FATHOM_URL,7*86400000],['local',local,sourceURL,36*3600000]]){const old=previous?.[key];result[key]=check.status==='fulfilled'?{items:check.value,checkedAt:check.value.checkedAt||check.value[0]?.checkedAt||Date.now(),stale:false,sourceURL:url}:{items:old&&Date.now()-old.checkedAt<ttl?old.items:[],checkedAt:old?.checkedAt||null,stale:true,error:check.reason?.message||'Source unavailable',sourceURL:old?.sourceURL||url};}return result;
}
module.exports={parseCinemark,combineOfficial,mergeLocal,parseFathom,parseLocal,inferredDate,safeURL,refreshCinema,todayDenver,normalizeLocalService};
