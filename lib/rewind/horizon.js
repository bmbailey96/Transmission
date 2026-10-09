const cheerio=require('cheerio');
const SOURCE='https://grasshopperfilm.com/';
const MTFF='https://www.montanafilmfestival.org/films/feature/chronovisor/';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function safeURL(s,hosts){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.includes(u.hostname)?u.href:null;}catch{return null;}}
function parseDistributor(html,at=Date.now()){
 const $=cheerio.load(html),items=[];
 $('a[href*="/film/"]').each((_,el)=>{const a=$(el),title=a.find('h6').text().trim(),sourceURL=safeURL(a.attr('href'),['grasshopperfilm.com','www.grasshopperfilm.com']),note=a.find('p').first().text().trim();if(!title||!sourceURL||items.some(r=>r.sourceURL===sourceURL))return;
 const status=/new to digital/i.test(note)?'digital':/new to home video/i.test(note)?'physical':/^opens|coming soon/i.test(note)?'announced':'limited';
 items.push({title,source:'Grasshopper Film',sourceURL,sourceStatus:status,sourceNote:status==='digital'?'Distributor lists a digital release':status==='physical'?'Distributor lists a physical release':status==='announced'?'Distributor lists an upcoming theatrical release':'Distributor lists theatrical screenings',checkedAt:at,screenings:[]});});
 if(!items.length)throw Error('Distributor layout could not be read');return items.slice(0,16);
}
function parseMontana(html,at=Date.now()){
 const $=cheerio.load(html),text=$('body').text(),year=text.match(/(20\d{2})\s+MTFF/)?.[1]||text.match(/October\s+22\s*[–-]\s*25,\s*(20\d{2})/)?.[1];
 // Keep the verified edition fixed when the page omits its year. An old
 // schedule is never rolled forward based on the current clock.
 // This URL belongs to the independently verified 2026 festival edition.
 if(!/Chronovisor/i.test($('h1').text()))return [];
 const edition=year||'2026';
 return [...text.matchAll(/(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday),\s*(\d{1,2})\/(\d{1,2})\s+at\s+(\d{1,2}:\d{2}\s*[ap]m)/gi)].map(m=>{const date=edition+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');return {date,time:m[4],weekday:m[1],location:'Missoula, MT',label:'Montana Film Festival',scope:'regional',sourceURL:MTFF,checkedAt:at};}).filter(r=>{const d=new Date(r.date+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===r.date&&d.toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}).toLowerCase()===r.weekday.toLowerCase();}).map(({weekday,...r})=>r);
}
async function html(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Source returned HTTP '+r.status);return r.text();}
async function catalog(item){
 const key=process.env.TMDB_API_KEY||require('./catalog-key.json').key;
 const request=async(path,params={})=>{const u=new URL('https://api.themoviedb.org/3'+path);u.searchParams.set('api_key',key);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Catalog lookup failed');return r.json();};
 const matches=(await request('/search/movie',{query:item.title,include_adult:false})).results.filter(m=>norm(m.title)===norm(item.title));
 if(matches.length!==1)return item;const m=await request('/movie/'+matches[0].id,{append_to_response:'credits,release_dates,keywords'});if(m.runtime&&m.runtime<60)return null;
 return {...item,title:m.title,id:m.id,release_date:m.release_date,poster_path:m.poster_path,runtime:m.runtime||null,overview:m.overview||'',director:(m.credits?.crew||[]).filter(c=>c.job==='Director').map(c=>c.name).join(', '),genre_ids:(m.genres||[]).map(g=>g.id),meta:{genres:m.genres,credits:{crew:(m.credits?.crew||[]).filter(c=>['Director','Writer','Screenplay','Story'].includes(c.job)).map(c=>({name:c.name,job:c.job}))},keywords:m.keywords},details:{id:m.id,runtime:m.runtime,release_dates:m.release_dates}};
}
const SOURCES=[
 {name:'Grasshopper Film',url:SOURCE,parse:parseDistributor},
 {name:'Janus Films',url:'https://www.janusfilms.com/',parse:parseJanus},
 {name:'Kino Lorber',url:'https://kinolorber.com/',parse:parseKino},
 {name:'Film release news',url:'https://news.google.com/rss/search?q=film+acquires+OR+%22release+date%22+OR+%22festival+premiere%22+when:14d&hl=en-US&gl=US&ceid=US:en',parse:parseReleaseNews}
];
function cleanTitle(text){return String(text||'').replace(/&#039;|&apos;/g,"'").replace(/&rsquo;|&#8217;/g,'’').replace(/&amp;/g,'&').trim();}
function quotedTitle(text){return text.match(/(?<![\p{L}\p{N}])['‘“]([^‘“]+?)['’”](?![\p{L}\p{N}])/u)?.[1]?.replace(/[,.:;]+$/,'').trim();}
function parseJanus(html,at=Date.now()){
 const $=cheerio.load(html),rows=new Map();$('a[href*="/films/"]').each((_,el)=>{const a=$(el),title=cleanTitle(a.find('img').attr('alt')||a.text());let url;try{url=new URL(a.attr('href'),'https://www.janusfilms.com/').href;}catch{return;}if(!title||!safeURL(url,['www.janusfilms.com','janusfilms.com'])||!/\/films\/\d+$/.test(url)||rows.has(url))return;rows.set(url,{title,source:'Janus Films',sourceURL:url,sourceStatus:'limited',sourceNote:'Featured in Janus’s current release lineup; check the film page for cities and dates',checkedAt:at,screenings:[]});});if(!rows.size)throw Error('Janus lineup unavailable');return [...rows.values()].slice(0,8);
}
function parseKino(html,at=Date.now()){
 const $=cheerio.load(html),rows=new Map();$('a[href^="/film/"]').each((_,el)=>{const a=$(el),path=a.attr('href'),title=cleanTitle(decodeURIComponent(path.split('/film/')[1]).replace(/-/g,' '));if(!title||rows.has(path))return;rows.set(path,{title,source:'Kino Lorber',sourceURL:new URL(path,'https://kinolorber.com/').href,sourceStatus:'limited',sourceNote:'Kino Lorber lists theatrical tickets; local participation and home release not established',checkedAt:at,screenings:[]});});
 $('h2').each((_,el)=>{const heading=cleanTitle($(el).text());if(!/acquires|rights|acquisition/i.test(heading))return;const title=quotedTitle(heading);const href=$(el).closest('a').attr('href')||$(el).parent().find('a[href*="/press/"]').attr('href');if(!title||!href)return;const url=new URL(href,'https://kinolorber.com/').href;if(!safeURL(url,['kinolorber.com'])||rows.has(url))return;rows.set(url,{title,source:'Kino Lorber',sourceURL:url,sourceStatus:'announced',sourceNote:'Distribution rights announced; a US release date is not established',news:[{title:heading,url,source:'Kino Lorber'}],checkedAt:at,screenings:[]});});if(!rows.size)throw Error('Kino lineup unavailable');return [...rows.values()].slice(0,10);
}
function parseReleaseNews(xml,at=Date.now()){
 const $=cheerio.load(xml,{xmlMode:true}),rows=[];for(const el of $('item').toArray()){const e=$(el),headline=cleanTitle(e.find('title').text()),publishedAt=e.find('pubDate').text(),stamp=Date.parse(publishedAt),url=safeURL(e.find('link').text(),['news.google.com']);if(!url||!Number.isFinite(stamp)||stamp>at||at-stamp>14*86400000||!/acquires|release date|premiere|distribution|theatrical|trailer/i.test(headline))continue;const title=quotedTitle(headline);if(!title||title.length<3||title.length>100||rows.some(r=>norm(r.title)===norm(title)))continue;const source=e.find('source').text()||'Film news';rows.push({title,source,sourceURL:url,sourceStatus:'news',sourceNote:'Film news reported '+new Date(stamp).toISOString().slice(0,10)+'; dates and availability require confirmation',news:[{title:headline,url,publishedAt:new Date(stamp).toISOString(),source}],checkedAt:at,screenings:[]});}return rows.slice(0,10);
}

async function refreshHorizon(previous){
 const at=Date.now(),checks=await Promise.allSettled(SOURCES.map(source=>html(source.url).then(h=>source.parse(h,at)))),festival=await Promise.allSettled([html(MTFF).then(h=>parseMontana(h,at))]);
 const sources=SOURCES.map((s,i)=>({name:s.name,url:s.url,checkedAt:checks[i].status==='fulfilled'?at:previous?.sources?.find(p=>p.name===s.name)?.checkedAt||null,stale:checks[i].status!=='fulfilled'}));
 const rows=checks.flatMap((check,i)=>check.status==='fulfilled'?check.value.map(row=>({...row,sourceGroup:SOURCES[i].name})):(previous?.items||[]).filter(m=>(m.sourceGroup||m.source)===SOURCES[i].name&&at-m.checkedAt<7*86400000).map(m=>({...m,stale:true}))),items=[];let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<rows.length){const index=next++,raw=rows[index];let item;try{item=raw.stale?raw:await catalog(raw);}catch{item=previous?.items?.find(m=>m.sourceURL===raw.sourceURL)?{...previous.items.find(m=>m.sourceURL===raw.sourceURL),...raw}:raw;}if(item){if(norm(item.title)==='chronovisor'){if(festival[0].status==='fulfilled')item.screenings=festival[0].value;else item.screenings=(previous?.items?.find(m=>m.id===item.id)?.screenings||[]).map(s=>({...s,stale:true}));}items[index]=item;}}}));
 const unique=new Map();for(const item of items.filter(Boolean)){const key=item.id?'film:'+item.id:item.sourceURL,prior=unique.get(key);if(prior){prior.news=[...(prior.news||[]),...(item.news||[])];prior.releaseSources=[...(prior.releaseSources||[{name:prior.source,url:prior.sourceURL}]),{name:item.source,url:item.sourceURL}];}else unique.set(key,item);}
 return {items:[...unique.values()],sources,checkedAt:at,generatedAt:at,stale:checks.every(c=>c.status==='rejected'),sourceURL:SOURCE,festivalCheckedAt:festival[0].status==='fulfilled'?at:previous?.festivalCheckedAt||null};
}
function filmEvents(feed,id,today){if(!feed||feed.stale||Date.now()-feed.checkedAt>7*86400000)return [];const film=feed.items.find(m=>m.id===id);if(!film||film.stale||Date.now()-film.checkedAt>7*86400000)return [];
 const events=[];for(const n of film.news||[]){if(n.publishedAt&&Date.now()-Date.parse(n.publishedAt)<14*86400000)events.push({key:'news:'+id+':'+n.url,kind:'release-news',label:n.title,link:n.url});}if(['digital','physical'].includes(film.sourceStatus))events.push({key:'horizon:'+id+':'+film.sourceStatus,kind:'release-news',label:film.sourceNote+' · verify US viewing options',link:film.sourceURL});
 for(const s of film.screenings||[])if(!s.stale&&s.date>=today&&Date.now()-s.checkedAt<7*86400000)events.push({key:'festival:'+id+':'+s.date+':'+s.time,kind:'release-news',date:s.date,label:s.label+' · '+s.location+' · '+s.date+' '+s.time+' MT',link:s.sourceURL});return events;
}
module.exports={parseDistributor,parseMontana,parseJanus,parseKino,parseReleaseNews,refreshHorizon,filmEvents};
