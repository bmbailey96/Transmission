const assert=require('node:assert/strict');
const path=require.resolve('@netlify/blobs');const state=new Map();
require.cache[path]={id:path,filename:path,loaded:true,exports:{connectLambda(){},getStore(){return {get:async key=>state.get(key),setJSON:async(key,value)=>state.set(key,value)}}}};
let providers={rent:[{provider_id:10,provider_name:'Amazon Video'}]},amount=19.99,mails=[];
global.fetch=async(url,options={})=>{
 const u=String(url);
 if(u.includes('resend.com')){mails.push(JSON.parse(options.body));return {ok:true};}
 if(u.includes('watch/providers'))return {ok:true,json:async()=>({results:{US:providers}})};
 if(u.includes('release_dates'))return {ok:true,json:async()=>({results:[]})};
 if(u.includes('/sources'))return {ok:true,json:async()=>[{name:'Amazon',region:'US',type:'rent',price:amount,format:'HD',web_url:'https://www.amazon.com/test'}]};
 if(u.includes('/releases'))return {ok:true,json:async()=>({releases:[]})};
 throw Error('Unexpected fixture request');
};
const {handler}=require('../netlify/functions/rewind-check-background');
(async()=>{
 state.set('watchlist',{enabled:true,services:['Shudder'],movies:[{id:9,title:'Small Film',alert:{mode:'mine',maxPrice:7.99}}]});
 await handler({});assert.equal(mails.length,0);assert.equal(state.get('film-9').seen.length,0);
 providers.flatrate=[{provider_id:1,provider_name:'Shudder Amazon Channel'}];await handler({});assert.equal(mails.length,0);
 providers.flatrate.push({provider_id:2,provider_name:'Shudder'});await handler({});assert.equal(mails.length,1);assert.match(mails[0].html,/Included with Shudder/);assert.doesNotMatch(mails[0].html,/Rent on/);
 await handler({});assert.equal(mails.length,1);
 process.env.WATCHMODE_API_KEY='fixture';state.set('watchlist',{enabled:true,movies:[{id:9,title:'Small Film',alert:{mode:'rental',maxPrice:7.99}}]});await handler({});assert.equal(mails.length,1);
 amount=7.99;await handler({});assert.equal(mails.length,2);assert.match(mails[1].html,/Rent for \$7.99/);await handler({});assert.equal(mails.length,2);
 delete process.env.WATCHMODE_API_KEY;
 state.set('watchlist',{enabled:true,services:['Shudder'],movies:[{id:1290418,title:'The Cycle',alert:{mode:'mine',maxPrice:7.99}}]});providers={};await handler({});assert.equal(mails.length,3);assert.match(mails[2].html,/Shudder announced: 2026-10-23/);assert.match(mails[2].html,/letterboxd.com\/shudder/);await handler({});assert.equal(mails.length,3);
 console.log('Worker preferences: suppress premium/channel spam, subscription detection, exact-price threshold, announced-date emails and deduplication passed');
})().catch(e=>{console.error(e);process.exitCode=1});
