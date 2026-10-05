(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReleaseModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAY=86400000;
  const date = x => typeof x==='string' && /^\d{4}-\d{2}-\d{2}/.test(x) && Number.isFinite(Date.parse(x.slice(0,10)+'T12:00:00Z')) ? x.slice(0,10) : null;
  const days=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/DAY);
  const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
  function datesFor(details){return details?.release_dates?.results?.find(r=>r.iso_3166_1==='US')?.release_dates || [];}
  function stages(details,today){const dates=datesFor(details);const first=type=>dates.filter(r=>type.includes(r.type)).map(r=>date(r.release_date)).filter(Boolean).sort()[0]||null;return {limited:first([2]),wide:first([3]),digital:first([4]),physical:first([5]),today};}
  function quantile(xs,p){const a=[...xs].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)];}
  function windowFor(anchor,samples,today){if(!anchor||samples.length<5)return null;const low=quantile(samples,.2),high=quantile(samples,.8);const start=addDays(anchor,low),end=addDays(anchor,high);return {start,end,samples:samples.length,low,high,overdue:end<today};}
  function digitalEstimate(details,comparables,today){const own=stages(details,today);if(own.digital||!own.wide&&!own.limited)return null;const anchor=own.wide||own.limited;if(anchor>today)return null;
    const ids=new Set();const samples=[];for(const d of comparables){if(!d||d.id===details.id||ids.has(d.id))continue;ids.add(d.id);const s=stages(d,today),a=s.wide||s.limited;if(a&&s.digital&&s.digital<=today&&days(a,today)<=730){const n=days(a,s.digital);if(n>=7&&n<=180)samples.push(n);}}
    return windowFor(anchor,samples,today);
  }
  function quoteIdentity(o){return `${o.kind}:${String(o.provider).toLowerCase().replace(/[^a-z0-9]/g,'')}:${o.format||''}`;}
  function recordQuotes(history,offers,checkedAt){const next=Array.isArray(history)?history.filter(r=>Number.isFinite(r.price)&&r.price>=0&&Number.isFinite(r.at)):[];if(!Number.isFinite(checkedAt))return next;
    for(const o of offers||[]){if(!['rent','buy'].includes(o.kind)||typeof o.price!=='number'||!Number.isFinite(o.price)||o.price<0)continue;const key=quoteIdentity(o);if(!next.some(r=>r.key===key&&r.at===checkedAt))next.push({key,kind:o.kind,provider:o.provider,format:o.format||null,price:o.price,at:checkedAt});}
    return next.sort((a,b)=>a.at-b.at).slice(-240);
  }
  function latestPriceChange(history,offers){for(const o of offers||[]){if(o.kind!=='rent'||typeof o.price!=='number')continue;const rows=(history||[]).filter(r=>r.key===quoteIdentity(o)).sort((a,b)=>b.at-a.at);const previous=rows.find(r=>r.price!==o.price);if(previous&&previous.price>o.price)return {from:previous.price,to:o.price,provider:o.provider,format:o.format,at:rows[0]?.at};}return null;}
  function priceEstimate(movie,offers,comparables,today,threshold=9.99){const premium=(offers||[]).filter(o=>o.kind==='rent'&&typeof o.price==='number'&&o.price>=15&&o.price>threshold).sort((a,b)=>a.price-b.price)[0];if(!premium)return null;
    const key=quoteIdentity(premium);const initial=(movie.priceHistory||[]).filter(r=>r.key===key&&r.price>=15).sort((a,b)=>a.at-b.at)[0];if(!initial)return null;
    const samples=[],ids=new Set();for(const m of comparables){if(m.id===movie.id||ids.has(m.id))continue;ids.add(m.id);const rows=(m.priceHistory||[]).filter(r=>r.key===key).sort((a,b)=>a.at-b.at);const first=rows.find(r=>r.price>=15),drop=first&&rows.find(r=>r.at>first.at&&r.price<=threshold);if(!drop)continue;const prior=rows.filter(r=>r.at<drop.at).at(-1);if(!prior||drop.at-prior.at>10*DAY||drop.at-first.at>120*DAY)continue;samples.push(Math.ceil((drop.at-first.at)/DAY));}
    const estimate=windowFor(new Date(initial.at).toISOString().slice(0,10),samples,today);return estimate?{...estimate,provider:premium.provider,format:premium.format,threshold}:null;
  }
  function matchingAnnouncements(feed,id){return (feed?.announcements||[]).filter(r=>r.tmdbId===id&&r.region==='US'&&['subscription','digital','theatrical','price'].includes(r.kind)&&r.sourceUrl&&/^https:\/\//.test(r.sourceUrl)&&(!r.date||date(r.date))&&(!r.expires||r.expires>=feed.today));}
  function group(status){if(status?.stale)return 'waiting';if((status?.offers||[]).some(o=>o.kind==='free'||o.kind==='subscription'&&o.included))return 'now';if((status?.offers||[]).some(o=>['rent','buy'].includes(o.kind)))return 'paid';return 'waiting';}
  function storeKey(name){const n=String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');if(['appletv','appletvstore','itunes'].includes(n))return 'apple';if(['amazon','amazonvideo','primevideo','amazonprimevideo'].includes(n))return 'amazon';return n;}
  function storeLabel(name){const key=storeKey(name);return key==='apple'?'Apple TV':key==='amazon'?'Prime Video':name;}
  function qualityRank(value){return /4k|uhd/i.test(value||'')?0:/hd/i.test(value||'')?1:/sd/i.test(value||'')?3:2;}
  function cost(offers,budget=7.99,stale=false){
    const all=offers||[];
    const included=all.filter(o=>o.kind==='subscription'&&o.included);
    if(included.length)return {band:stale?'waiting':'free',badge:'INCLUDED',caption:[...new Set(included.map(o=>o.provider))].join(' · '),price:0,offer:included[0],stale};
    const free=all.filter(o=>o.kind==='free');if(free.length)return {band:stale?'waiting':'free',badge:'FREE',caption:free[0].provider+(free[0].adSupported?' · with ads':''),price:0,offer:free[0],stale};
    const rent=all.filter(o=>o.kind==='rent'),buy=all.filter(o=>o.kind==='buy');
    const quoted=rent.filter(o=>typeof o.price==='number'&&Number.isFinite(o.price)&&o.price>=0);
    // Compare HD/4K where supplied. An SD-only bargain should not mask an HD rental.
    const highQuality=quoted.filter(o=>qualityRank(o.format)<=1),usable=highQuality.length?highQuality:quoted;
    const preferred=usable.filter(o=>['apple','amazon'].includes(storeKey(o.provider)));
    const sort=(a,b)=>a.price-b.price||qualityRank(a.format)-qualityRank(b.format)||Number(storeKey(b.provider)==='apple')-Number(storeKey(a.provider)==='apple')||String(a.provider).localeCompare(String(b.provider));
    const chosen=[...(preferred.length?preferred:usable)].sort(sort)[0];
    if(chosen){const cheaper=[...usable].sort(sort).find(o=>o.price<chosen.price);const same=usable.filter(o=>o.price===chosen.price&&qualityRank(o.format)===qualityRank(chosen.format)&&['apple','amazon'].includes(storeKey(o.provider)));const names=[...new Set(same.map(o=>storeLabel(o.provider)))];return {band:stale?'waiting':chosen.price<=budget?'cheap':'premium',badge:'$'+chosen.price.toFixed(2),caption:'Rent · '+(names.length?names.join(' / '):storeLabel(chosen.provider))+(chosen.format?' · '+chosen.format:''),price:chosen.price,offer:chosen,cheaper,stale};}
    if(rent.length)return {band:stale?'waiting':'unknown',badge:'RENT',caption:'Price not checked',price:null,offer:rent.find(o=>['apple','amazon'].includes(storeKey(o.provider)))||rent[0],stale};
    if(buy.length){const quotes=buy.filter(o=>typeof o.price==='number'&&Number.isFinite(o.price)&&o.price>=0).sort(sort);return {band:stale?'waiting':'buy',badge:quotes.length?'$'+quotes[0].price.toFixed(2):'BUY',caption:'Purchase only · '+(quotes.length?storeLabel(quotes[0].provider):'no rental listed'),price:quotes[0]?.price??null,offer:quotes[0]||buy[0],stale};}
    return {band:'waiting',badge:'WAITING',caption:all.some(o=>o.kind==='subscription')?'Separate subscription needed':'No current offer',price:null,offer:null,stale};
  }
  function compactOffers(offers){const groups=new Map();for(const o of offers||[]){const key=[o.kind,storeKey(o.provider),o.channel,typeof o.price==='number'?o.price:'?',o.included].join(':');if(!groups.has(key))groups.set(key,{...o,provider:['rent','buy'].includes(o.kind)?storeLabel(o.provider):o.provider,formats:[]});const row=groups.get(key);if(o.format&&!row.formats.includes(o.format))row.formats.push(o.format);if(qualityRank(o.format)<qualityRank(row.format)){row.format=o.format;row.link=o.link||row.link;}}return [...groups.values()].map(o=>({...o,format:o.formats.sort((a,b)=>qualityRank(a)-qualityRank(b)).join(' / ')||null}));}
  function preference(raw){return {mode:['any','mine','rental'].includes(raw?.mode)?raw.mode:'any',maxPrice:typeof raw?.maxPrice==='number'&&Number.isFinite(raw.maxPrice)&&raw.maxPrice>=0&&raw.maxPrice<=100?raw.maxPrice:7.99};}
  return {date,days,addDays,datesFor,stages,digitalEstimate,quoteIdentity,recordQuotes,latestPriceChange,priceEstimate,matchingAnnouncements,group,preference,storeKey,storeLabel,qualityRank,cost,compactOffers};
});
