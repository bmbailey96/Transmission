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
 return {...item,id:m.id,release_date:m.release_date,poster_path:m.poster_path,runtime:m.runtime||null,overview:m.overview||'',director:(m.credits?.crew||[]).filter(c=>c.job==='Director').map(c=>c.name).join(', '),genre_ids:(m.genres||[]).map(g=>g.id),meta:{genres:m.genres,credits:m.credits,keywords:m.keywords},details:{id:m.id,runtime:m.runtime,release_dates:m.release_dates}};
}
async function refreshHorizon(previous){
 const at=Date.now(),[distributor,festival]=await Promise.allSettled([html(SOURCE).then(h=>parseDistributor(h,at)),html(MTFF).then(h=>parseMontana(h,at))]);
 if(distributor.status==='rejected')return {...previous,items:previous&&at-previous.checkedAt<7*86400000?previous.items:[],stale:true,error:'Distributor check unavailable',generatedAt:at};
 const rows=distributor.value,items=[];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<rows.length){const index=next++,raw=rows[index];let item;try{item=await catalog(raw);}catch{item=previous?.items?.find(m=>m.sourceURL===raw.sourceURL)?{...previous.items.find(m=>m.sourceURL===raw.sourceURL),...raw}:raw;}if(item){if(norm(item.title)==='chronovisor'){if(festival.status==='fulfilled')item.screenings=festival.value;else item.screenings=(previous?.items?.find(m=>m.id===item.id)?.screenings||[]).map(s=>({...s,stale:true}));}items[index]=item;}}}));
 return {items:items.filter(Boolean),checkedAt:at,generatedAt:at,stale:false,sourceURL:SOURCE,festivalCheckedAt:festival.status==='fulfilled'?at:previous?.festivalCheckedAt||null};
}
function filmEvents(feed,id,today){if(!feed||feed.stale||Date.now()-feed.checkedAt>7*86400000)return [];const film=feed.items.find(m=>m.id===id);if(!film)return [];
 const events=[];if(['digital','physical'].includes(film.sourceStatus))events.push({key:'horizon:'+id+':'+film.sourceStatus,kind:'release-news',label:film.sourceNote+' · verify US viewing options',link:film.sourceURL});
 for(const s of film.screenings||[])if(!s.stale&&s.date>=today&&Date.now()-s.checkedAt<7*86400000)events.push({key:'festival:'+id+':'+s.date+':'+s.time,kind:'release-news',date:s.date,label:s.label+' · '+s.location+' · '+s.date+' '+s.time+' MT',link:s.sourceURL});return events;
}
module.exports={parseDistributor,parseMontana,refreshHorizon,filmEvents};
