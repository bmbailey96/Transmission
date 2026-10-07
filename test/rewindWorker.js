const assert=require('node:assert/strict');
const netlifyPath=require.resolve('@netlify/blobs');
const data=new Map([['watchlist',{enabled:true,movies:[{id:1204680,title:'Coyote vs. Acme'}]}]]);
require.cache[netlifyPath]={id:netlifyPath,filename:netlifyPath,loaded:true,exports:{connectLambda(){},getStore(){return {get:async k=>data.get(k),setJSON:async(k,v)=>data.set(k,v)}}}};
let providers={rent:[{provider_id:10,provider_name:'Amazon Video'}]};let mailCount=0,fail=false,mailFail=false,mails=[];
global.fetch=async (url,options={})=>{
 if(String(url).includes('resend.com')){mailCount++;mails.push(JSON.parse(options.body));return {ok:!mailFail,status:500};}
 if(fail) return {ok:false,status:503};
 return {ok:true,json:async()=>String(url).includes('watch/providers')?{results:{US:providers}}:{results:[]}};
};
const {handler}=require('../netlify/functions/rewind-check-background');
(async()=>{
 await handler({});assert.equal(mailCount,1);
 await handler({});assert.equal(mailCount,1);
 fail=true;await handler({});assert.equal(mailCount,1);assert.equal(data.get('film-1204680').seen.length,1);
 fail=false;providers.flatrate=[{provider_id:1899,provider_name:'HBO Max'}];await handler({});assert.equal(mailCount,2);
 await handler({});assert.equal(mailCount,2);
 // Six films produce five lines, and the sixth retains its pending checkpoint.
 data.clear();providers={rent:[{provider_id:10,provider_name:'Amazon Video'},{provider_id:20,provider_name:'Apple TV Store'}],buy:[{provider_id:10,provider_name:'Amazon Video'}]};
 data.set('watchlist',{enabled:true,movies:Array.from({length:6},(_,i)=>({id:100+i,title:'Film '+i}))});
 await handler({});assert.equal((mails.at(-1).html.match(/<li>/g)||[]).length,5);assert.match(mails.at(-1).html,/1 more update/);assert.equal(data.has('film-105'),false);assert.doesNotMatch(mails.at(-1).html,/Buy on|Apple TV|Source \/ viewing/);
 mailFail=true;await assert.rejects(handler({}));assert.equal(data.has('film-105'),false);mailFail=false;await handler({});assert.equal(data.has('film-105'),true);assert.match(mails.at(-1).subject,/1 film update/);
 const sent=mailCount;await handler({});assert.equal(mailCount,sent);
 providers.rent.push({provider_id:30,provider_name:'YouTube'});await handler({});assert.equal(mailCount,sent,'New rental storefront must not alert');
 console.log('Rewind worker: first report, no duplicates, outage preserves state, subscription alert');
})().catch(e=>{console.error(e);process.exitCode=1});
