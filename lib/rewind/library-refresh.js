const Model=require('./rewind-model');
function rotate(rows,cursor,count){if(!rows.length)return {rows:[],cursor:0};const n=Math.min(count,rows.length);return {rows:Array.from({length:n},(_,i)=>rows[(cursor+i)%rows.length]),cursor:(cursor+n)%rows.length};}
function targets(movies,state={}){const followed=rotate(movies.filter(m=>m.followRelease),state.followedCursor||0,120),older=rotate(movies.filter(m=>!m.followRelease),state.olderCursor||0,24);return {movies:[...followed.rows,...older.rows],followedCursor:followed.cursor,olderCursor:older.cursor};}
function snapshot(id,events,quotes,services,at=Date.now()){
 const freshQuotes=quotes&&at-quotes.checkedAt>=0&&at-quotes.checkedAt<6*3600000?quotes:null;
 const offers=events.filter(e=>!e.date&&!/^(announcement|calendar):/.test(e.key||'')&&['free','subscription','rent','buy'].includes(e.kind)).map(e=>({kind:e.kind,provider:e.provider,included:e.kind==='subscription'&&Model.included(e.provider,services),price:Number.isFinite(e.price)?e.price:null,format:e.format||null,link:e.link||null,source:e.source||'TMDB US providers'}));
 for(const offer of freshQuotes?.offers||[])offers.push({...offer,included:false});
 const priced=new Set(offers.filter(o=>Number.isFinite(o.price)&&['rent','buy'].includes(o.kind)).map(o=>o.kind+':'+Model.serviceKey(o.provider)));
 const filtered=offers.filter(o=>Number.isFinite(o.price)||!priced.has(o.kind+':'+Model.serviceKey(o.provider)));
 const unique=[...new Map(filtered.map(o=>[[o.kind,o.provider,o.format,o.price].join(':'),o])).values()];
 const announcements=events.filter(e=>e.date&&['subscription','digital'].includes(e.kind)).map(e=>({kind:e.kind,provider:e.provider,date:e.date,source:e.source||'Published release listing',sourceUrl:e.link||null}));
 const quotedAt=freshQuotes?.checkedAt||Math.max(0,...events.filter(e=>e.key?.startsWith('quote:')&&Number.isFinite(e.price)).map(e=>e.checkedAt||at))||null;
 const summary=Model.summary(unique)||{code:'nodata',kind:'unknown',label:'No current offer'};
 return {...summary,id,offers:unique,announcements,checkedAt:at,quoteCheckedAt:quotedAt,priceSources:freshQuotes?[freshQuotes.source||'US store quotes']:[],stale:false,source:'Scheduled US availability check'};
}
module.exports={rotate,targets,snapshot};
