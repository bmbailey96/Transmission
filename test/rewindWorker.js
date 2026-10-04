const assert=require('node:assert/strict');
const netlifyPath=require.resolve('@netlify/blobs');
const data=new Map([['watchlist',{enabled:true,movies:[{id:1204680,title:'Coyote vs. Acme'}]}]]);
require.cache[netlifyPath]={id:netlifyPath,filename:netlifyPath,loaded:true,exports:{connectLambda(){},getStore(){return {get:async k=>data.get(k),setJSON:async(k,v)=>data.set(k,v)}}}};
let providers={rent:[{provider_id:10,provider_name:'Amazon Video'}]};let mailCount=0,fail=false;
global.fetch=async url=>{
 if(String(url).includes('resend.com')){mailCount++;return {ok:true};}
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
 console.log('Rewind worker: first report, no duplicates, outage preserves state, subscription alert');
})().catch(e=>{console.error(e);process.exitCode=1});
