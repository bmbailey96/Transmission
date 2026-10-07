const { connectLambda, getStore } = require('@netlify/blobs');
const {movieEvents,pendingEvents,digestKey,eligibleEvents} = require('../../lib/rewind/availability');
const {meaningfulEvents,buildDigest}=require('../../lib/rewind/email-digest');
exports.handler = async event => {
  connectLambda(event);
  const store = getStore({name:'rewind-alerts'});
  const priceStore=getStore({name:'rewind-prices'});
  let settings = await store.get('watchlist',{type:'json'});
  if (!settings) {
    settings = {enabled:true,movies:[{id:1204680,title:'Coyote vs. Acme'}]};
    await store.setJSON('watchlist',settings);
  }
  if (!settings?.enabled) return {statusCode:200};
  const changed = [];
  const updates = [];
  for (const movie of settings.movies) {
    try {
      const events = await movieEvents(movie.id,settings.services,{title:movie.title,store:priceStore});
      const prior = await store.get(`film-${movie.id}`,{type:'json'});
      // First check reports current providers and future dates. Failed lookups never
      // erase previous observations or manufacture availability changes.
      const eligible=eligibleEvents(events,movie.alert);
      const policy=digestKey({alert:movie.alert||{mode:'any',maxPrice:5.99},services:settings.services||[]});
      const policyChanged=prior?.policy&&prior.policy!==policy;
      const initialEvents=eligible.filter(e=>!e.key.endsWith(':arrived'));
      const pending=prior&&!policyChanged?pendingEvents(eligible,prior.seen):initialEvents;
      const fresh=meaningfulEvents(pending,policyChanged?[]:prior?.seen||[],events);
      if (!fresh.length) {await store.setJSON(`film-${movie.id}`,{seen:[...new Set([...(policyChanged?[]:prior?.seen||[]),...eligible.map(e=>e.key)])],policy});continue;}
      if (fresh.length) { changed.push({movie,events:fresh,currentEvents:events}); updates.push({id:movie.id,policy,seen:[...new Set([...(policyChanged?[]:prior?.seen || []),...eligible.map(e=>e.key)])]}); }
    } catch (err) { console.error(`Rewind film ${movie.id}: ${err.message}`); }
  }
  let cinemaCheckpoint=null;
  if(settings.eventAlerts){
    try{
      const {refreshCinema,todayDenver}=require('../../lib/rewind/cinema'),H=require('../../lib/rewind/hub-model');
      const cinemaStore=getStore({name:'rewind-cinema'});let calendar=await cinemaStore.get('calendar',{type:'json'});
      if(!calendar||Date.now()-calendar.generatedAt>6*3600000){calendar=await refreshCinema(calendar);await cinemaStore.setJSON('calendar',calendar);}
      const films=[...settings.movies,...settings.eventFilms||[]],followed=new Set(settings.followedEvents||[]),known=await store.get('cinema-seen',{type:'json'})||[],fresh=[];const day=todayDenver();
      for(const [kind,key] of [['National Fathom event','events'],['Kalispell screenings listed','local']]){
        if(calendar[key]?.stale)continue;
        for(const item of calendar[key]?.items||[]){if(item.end<day)continue;const match=films.find(m=>H.matchEvent(item,m));if(!match&&!followed.has(item.id))continue;
          const dates=(item.dates||[]).filter(d=>d>=day);const keys=[...dates.map(d=>'cinema:'+item.id+':date:'+d),...(item.ranges||[]).filter(r=>r.end>=day).map(r=>'cinema:'+item.id+':window:'+r.start+':'+r.end)];const newKeys=keys.filter(key=>!known.includes(key));
          if(newKeys.length)fresh.push({title:item.title,key:'cinema:'+item.id+':'+digestKey(newKeys),checkpointKeys:newKeys,label:kind+': '+item.title+' · '+(item.dateLabel||dates.join(', ')),link:item.url});
        }
      }
      if(fresh.length){for(const e of fresh)changed.push({movie:{title:e.title},events:[e]});cinemaCheckpoint=known;}
    }catch(err){console.error('Rewind cinema: '+err.message);}
  }
  const receipt = await store.get('receipt',{type:'json'}) || {};
  if (!changed.length) {await store.setJSON('receipt',{...receipt,checkedAt:new Date().toISOString()});return {statusCode:200};}
  const digest=buildDigest(changed);
  const key = digestKey(digest.selected);
  const res = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`rewind-${key}`},body:JSON.stringify({from:process.env.DIGEST_FROM_EMAIL,to:'bmbailey96@gmail.com',subject:digest.subject,html:digest.html})});
  if (!res.ok) throw Error(`Rewind email failed: ${res.status}`);
  if(cinemaCheckpoint)await store.setJSON('cinema-seen',[...new Set([...cinemaCheckpoint,...digest.selected.flatMap(c=>c.events.flatMap(e=>e.checkpointKeys||[]))])].slice(-2000));
  const delivered=new Set(digest.selected.map(c=>c.movie.id));
  for (const u of updates.filter(u=>delivered.has(u.id))) await store.setJSON(`film-${u.id}`,{seen:u.seen,policy:u.policy});
  await store.setJSON('receipt',{checkedAt:new Date().toISOString(),emailedAt:new Date().toISOString()});
  return {statusCode:200};
};
