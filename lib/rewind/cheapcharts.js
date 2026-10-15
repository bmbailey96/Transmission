// Public integration documented at https://www.cheapcharts.com/llms.txt.
// Prices.php supplies a previous purchase price, not a dated history or rental series.
const BASE='https://buster.cheapcharts.de/v1/gptapi/Prices.php';
const STORES={itunes:'Apple TV',amazon:'Prime Video',vudu:'Fandango at Home'};
const memory=new Map(),pending=new Map(),CACHE_MS=12*3600000;
const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10000?n:null;
function sourceLink(value,store){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.cheapcharts.com'&&u.pathname.startsWith('/us/'+store+'/')?u.href:null;}catch{return null;}}
function extractPrevious(body,imdbId,store){
 if(body?.status!=='success'||!Array.isArray(body.results?.buymovies))throw Error('Earlier store prices unavailable');
 const matches=body.results.buymovies.filter(r=>r.imdbId===imdbId&&!r.isMovieBundle&&r.currency==='USD');
 if(matches.length!==1)return null;
 const r=matches[0],link=sourceLink(r.cheapChartsProductPageUrl,store)||sourceLink(r.detail_url,store),price=amount(r.price),previousPrice=amount(r.priceBefore);
 if(!link||price===null)return null;
 return {kind:'buy',provider:STORES[store],store,region:'US',currency:'USD',price,previousPrice:previousPrice===price?null:previousPrice,previousAt:null,format:null,source:'CheapCharts',link};
}
async function lookupEarlierPrices(id,{store,fetcher=fetch,at=Date.now()}={}){
 const key='earlier-v1-'+id,cached=memory.get(key)||await store?.get(key,{type:'json'});
 if(cached&&Number.isFinite(cached.checkedAt)&&at>=cached.checkedAt&&at-cached.checkedAt<(cached.partial?3600000:CACHE_MS)){memory.set(key,cached);return cached;}
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const apiKey=process.env.TMDB_API_KEY||require('./catalog-key.json').key;
  const identity=await fetcher('https://api.themoviedb.org/3/movie/'+id+'?api_key='+encodeURIComponent(apiKey),{signal:AbortSignal.timeout(8000)});
  if(!identity.ok)throw Error('Film identity unavailable');const movie=await identity.json();
  if(Number(movie.id)!==id)throw Error('Film identity mismatch');
  const imdbId=movie.imdb_id;
  if(!/^tt\d{7,10}$/.test(imdbId||'')){const empty={id,entries:[],checkedAt:at,reason:'No IMDb match supplied',source:'CheapCharts'};memory.set(key,empty);if(store)try{await store.setJSON(key,empty);}catch{}return empty;}
  const results=await Promise.allSettled(Object.keys(STORES).map(async name=>{
   const url=new URL(BASE);url.search=new URLSearchParams({action:'getPrices',store:name,country:'us',itemType:'buymovies',imdbIDs:imdbId});
   const res=await fetcher(url.href,{signal:AbortSignal.timeout(8000)});if(!res.ok)throw Error('Earlier store prices unavailable');return extractPrevious(await res.json(),imdbId,name);
  }));
  if(results.every(r=>r.status==='rejected'))throw Error('Earlier store prices unavailable');
  const value={id,imdbId,entries:results.flatMap(r=>r.status==='fulfilled'&&r.value?[r.value]:[]),checkedAt:Date.now(),partial:results.some(r=>r.status==='rejected'),source:'CheapCharts',historyType:'undated-previous-purchase'};
  memory.set(key,value);if(memory.size>300)memory.delete(memory.keys().next().value);
  if(store)try{await store.setJSON(key,value);}catch{}return value;
 })();pending.set(key,task);try{return await task;}catch(error){if(cached)return {...cached,stale:true};throw error;}finally{pending.delete(key);}
}
module.exports={extractPrevious,lookupEarlierPrices,sourceLink};
