const {escapeHtml}=require('./availability');
const Model=require('./rewind-model');
const REWIND_URL='https://bekind-rewind.netlify.app/';
// Alert on useful changes, not every new storefront carrying the same film.
function meaningfulEvents(fresh,seen=[],current=fresh){
 const hadRental=seen.some(key=>key.startsWith('rent:')||key.startsWith('quote:rent:'));
 const available=current.some(e=>/^(free|flatrate|ads|rent|buy):/.test(e.key));
 return fresh.filter(e=>{
  if(e.kind==='buy')return false;
  if(e.kind==='subscription'&&(!e.included||Model.isChannel(e.provider)))return false;
  if(e.kind==='rent'&&e.price==null&&hadRental)return false;
  // Actual offers supersede a generic digital date, which can lag behind them.
  if(e.kind==='digital'&&available)return false;
  return true;
 });
}
function priority(e){
 if(e.kind==='subscription'&&/^flatrate:/.test(e.key))return 0;
 if(e.kind==='free')return 1;
 if(e.kind==='rent'&&Number.isFinite(e.price))return 2;
 if(e.kind==='rent')return 3;
 return 4;
}
function summarize(events){
 const sorted=[...events].sort((a,b)=>priority(a)-priority(b)||(a.price??Infinity)-(b.price??Infinity));
 const best=sorted[0];
 if(!best)return null;
 if(best.kind==='rent'&&best.price==null)return {...best,label:'Now available to rent'};
 return best;
}
function buildDigest(changes){
 const rows=changes.map(change=>({...change,event:summarize(change.events)})).filter(row=>row.event)
  .sort((a,b)=>priority(a.event)-priority(b.event));
 const selected=rows.slice(0,5),remaining=rows.length-selected.length;
 const subject=`Rewind: ${selected.length} film update${selected.length===1?'':'s'}`;
 const html=`<h2>${subject}</h2><ul>${selected.map(({movie,event:e})=>{
  const link=/^https:\/\//.test(e.link||'')?e.link:REWIND_URL;
  return `<li><strong>${escapeHtml(movie.title)}</strong>: ${escapeHtml(e.label)} <a href="${escapeHtml(link)}">View</a></li>`;
 }).join('')}</ul>${remaining?`<p>${remaining} more update${remaining===1?'':'s'} queued for the next daily check.</p>`:''}<p><a href="${REWIND_URL}">Open Rewind</a></p>`;
 return {subject,html,selected,remaining};
}
module.exports={meaningfulEvents,summarize,buildDigest};
