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
async function fetchHTML(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'Accept':'text/html','User-Agent':'Rewind-film-calendar/1.0'}});if(!r.ok)throw Error('Source returned HTTP '+r.status);return r.text();}
function normalizeLocalService(body,today=todayDenver()){
 if(body.error||!Array.isArray(body.movies)||!Number.isFinite(Date.parse(body.generated_at)))throw Error('Existing Kalispell service returned no verified calendar.');
 const checkedAt=Date.parse(body.generated_at);if(Date.now()-checkedAt>86400000)throw Error('Existing Kalispell calendar is too old.');
 return body.movies.filter(m=>typeof m.title==='string').map(m=>{const dates=[...new Set((m.dates||[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=today))].sort();return {id:'local:'+m.title.toLowerCase().replace(/[^a-z0-9]/g,''),title:m.title,dates,start:dates[0],end:dates.at(-1),screenings:[],scope:'local',source:'Kalispell Showtimes / TributeMovies',url:CINEMARK_URL,checkedAt};}).filter(m=>m.dates.length);
}
async function existingLocal(today){const r=await fetch(LOCAL_SERVICE_URL,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Existing Kalispell service HTTP '+r.status);return normalizeLocalService(await r.json(),today);}
async function refreshCinema(previous){
 const today=todayDenver();const [fathom,localService,localDirect]=await Promise.allSettled([fetchHTML(FATHOM_URL).then(h=>parseFathom(h,today)),existingLocal(today),fetchHTML(LOCAL_URL).then(h=>parseLocal(h,today))]);
 const local=localDirect.status==='fulfilled'&&localDirect.value.length?localDirect:localService;const checks=[fathom,local],result={generatedAt:Date.now(),today,theatre:'Cinemark Signature Stadium Kalispell 14',theatreURL:CINEMARK_URL};
 for(const [i,key] of ['events','local'].entries()){const check=checks[i],old=previous?.[key],sourceURL=i?(local===localDirect?LOCAL_URL:LOCAL_SERVICE_URL):FATHOM_URL;result[key]=check.status==='fulfilled'?{items:check.value,checkedAt:Date.now(),stale:false,sourceURL}:{items:old&&Date.now()-old.checkedAt<7*86400000?old.items:[],checkedAt:old?.checkedAt||null,stale:true,error:check.reason?.message||'Source unavailable',sourceURL};}return result;
}
module.exports={parseFathom,parseLocal,inferredDate,safeURL,refreshCinema,todayDenver,normalizeLocalService};
