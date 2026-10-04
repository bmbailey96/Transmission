const { connectLambda, getStore } = require('@netlify/blobs');
const {movieEvents,pendingEvents,digestKey,escapeHtml} = require('../../lib/rewind/availability');
exports.handler = async event => {
  connectLambda(event);
  const store = getStore({name:'rewind-alerts',consistency:'strong'});
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
      const events = await movieEvents(movie.id);
      const prior = await store.get(`film-${movie.id}`,{type:'json'});
      // First check reports current providers and future dates. Failed lookups never
      // erase previous observations or manufacture availability changes.
      const initialEvents = events.filter(e => !e.key.endsWith(':arrived'));
      const fresh = prior ? pendingEvents(events,prior.seen) : initialEvents;
      if (!prior && !fresh.length) {await store.setJSON(`film-${movie.id}`,{seen:events.map(e=>e.key)});continue;}
      if (fresh.length) { changed.push({movie,events:fresh}); updates.push({id:movie.id,seen:[...new Set([...(prior?.seen || []),...events.map(e=>e.key)])]}); }
    } catch (err) { console.error(`Rewind film ${movie.id}: ${err.message}`); }
  }
  const receipt = await store.get('receipt',{type:'json'}) || {};
  if (!changed.length) {await store.setJSON('receipt',{...receipt,checkedAt:new Date().toISOString()});return {statusCode:200};}
  const key = digestKey(changed);
  const html = `<h2>Rewind: new release information</h2>${changed.map(({movie,events})=>`<h3>${escapeHtml(movie.title)}</h3><ul>${events.map(e=>`<li>${escapeHtml(e.label)}${e.link ? ` <a href="https://www.themoviedb.org/movie/${movie.id}/watch?locale=US">Where to watch</a>` : ''}</li>`).join('')}</ul>`).join('')}<p>US release listings are not confirmed Kalispell showtimes. Provider listings can lag. Future digital dates do not identify a subscription service.</p>`;
  const res = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`rewind-${key}`},body:JSON.stringify({from:process.env.DIGEST_FROM_EMAIL,to:'bmbailey96@gmail.com',subject:`Rewind: ${changed.map(c=>c.movie.title).join(', ').slice(0,180)}`,html})});
  if (!res.ok) throw Error(`Rewind email failed: ${res.status}`);
  for (const u of updates) await store.setJSON(`film-${u.id}`,{seen:u.seen});
  await store.setJSON('receipt',{checkedAt:new Date().toISOString(),emailedAt:new Date().toISOString()});
  return {statusCode:200};
};
