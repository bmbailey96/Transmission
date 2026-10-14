const {connectLambda,getStore}=require('@netlify/blobs');
const {movieEvents}=require('../../lib/rewind/availability');
const {targets,snapshot}=require('../../lib/rewind/library-refresh');
exports.handler=async event=>{
 connectLambda(event);const store=getStore({name:'rewind-library'}),prices=getStore({name:'rewind-prices'});
 const library=await store.get('library',{type:'json'});if(!library?.movies?.length)return {statusCode:200};
 const state=await store.get('rotation',{type:'json'})||{},started=Date.now();
 if(started-(state.startedAt||0)<3600000)return {statusCode:200};
 await store.setJSON('rotation',{...state,startedAt:started});
 const batch=targets(library.movies,state),saved=await store.get('snapshots',{type:'json'})||{films:{}};
 saved.films||={};let completed=0,failed=0;
 for(let i=0;i<batch.movies.length&&Date.now()-started<11*60000;i+=4){
  await Promise.all(batch.movies.slice(i,i+4).map(async movie=>{try{
   const events=await movieEvents(movie.id,library.services,{title:movie.title,store:prices});
   const quote=await prices.get('quotes-'+movie.id,{type:'json'});
   saved.films[movie.id]=snapshot(movie.id,events,quote,library.services);completed++;
  }catch{failed++; /* Preserve the last successful snapshot on source failure. */ }}));
 }
 const ids=new Set(library.movies.map(m=>String(m.id)));for(const id of Object.keys(saved.films))if(!ids.has(id))delete saved.films[id];
 saved.generatedAt=Date.now();await store.setJSON('snapshots',saved);
 await store.setJSON('rotation',{followedCursor:batch.followedCursor,olderCursor:batch.olderCursor,startedAt:started,finishedAt:Date.now(),completed,failed});
 return {statusCode:200};
};
