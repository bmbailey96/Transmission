const Model=require('./rewind-model');
const CACHE_MS=6*3600000;
const memory=new Map(),pending=new Map();
const TMDB_KEY=process.env.TMDB_API_KEY||'000802da6224e125437187b196cde898';
const QUERY=`query RewindPrices($title: String!) {
 popularTitles(country: US, filter: {searchQuery: $title, objectTypes: [MOVIE]}, first: 12) {
  edges { node { content(country: US, language: en) { title fullPath externalIds { tmdbId } }
   offers(country: US, platform: WEB) { monetizationType presentationType retailPrice(language: en) currency standardWebURL package { clearName } }
  } }
 }
}`;
function dollars(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value!=='string'||! /^(?:US\$|\$)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/.test(value.trim()))return null;
 return Number(value.trim().replace(/^US\$|^\$/,'').replaceAll(',',''));
}
function extractQuotes(body,id){
 const edges=body?.data?.popularTitles?.edges;
 if(body?.errors?.length||!Array.isArray(edges))throw Error('Store price source unavailable');
 const matches=edges.map(e=>e.node).filter(n=>String(n?.content?.externalIds?.tmdbId)===String(id));
 if(matches.length!==1)return [];
 const offers=(matches[0].offers||[]).flatMap(o=>{
  const kind={RENT:'rent',BUY:'buy'}[o.monetizationType],price=dollars(o.retailPrice),provider=o.package?.clearName,link=Model.safeLink(o.standardWebURL);
  if(!kind||o.currency!=='USD'||price===null||!provider||!link)return [];
  return [{kind,provider,price,format:{_4K:'4K',HD:'HD',SD:'SD'}[o.presentationType]||null,link,region:'US',source:'JustWatch US prices',channel:Model.isChannel(provider),included:false}];
 });
 return [...new Map(offers.map(o=>[[o.kind,Model.serviceKey(o.provider),o.format,o.price].join(':'),o])).values()];
}
async function lookupPrices(id,{title,store}={}){
 const key='quotes-'+id,now=Date.now();
 let cached=memory.get(key);
 if(!cached&&store)cached=await store.get(key,{type:'json'});
 if(cached&&Number.isFinite(cached.checkedAt)&&now-cached.checkedAt>=0&&now-cached.checkedAt<CACHE_MS){memory.set(key,cached);return cached;}
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  if(!title){const res=await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}`,{signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('Film identity unavailable');title=(await res.json()).title;}
  if(typeof title!=='string'||!title.trim())throw Error('Film identity unavailable');
  const res=await fetch('https://apis.justwatch.com/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:QUERY,variables:{title:title.slice(0,200)}}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Store price source unavailable');
  const quotes=extractQuotes(await res.json(),id),result={id,offers:quotes,checkedAt:Date.now(),source:'JustWatch US prices'};
  if(store)await store.setJSON(key,result);
  memory.set(key,result);if(memory.size>600)memory.delete(memory.keys().next().value);
  return result;
 })();pending.set(key,task);
 try{return await task;}finally{pending.delete(key);}
}
module.exports={dollars,extractQuotes,lookupPrices};
