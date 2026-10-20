const TV=require('../../lib/rewind/tv');
const {connectLambda,getStore}=require('@netlify/blobs');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
exports.handler=async event=>{
 const reply=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'Method not allowed'});
 try{
  const auth=event.headers?.authorization||event.headers?.Authorization;
  if(!auth?.startsWith('Bearer '))return reply(401,{error:'Connect GitHub to share background checks across devices.'});
  const user=await fetch('https://api.github.com/user',{headers:{Authorization:auth,'User-Agent':'Rewind'},signal:AbortSignal.timeout(15000)});
  if(!user.ok||(await user.json()).login!=='bmbailey96')return reply(403,{error:'This library belongs to bmbailey96.'});
  connectLambda(event);const store=getStore({name:'rewind-library'});
  let library=await store.get('library',{type:'json'})||{movies:[],services:[]};
  if(event.httpMethod==='POST'){
   if((event.body||'').length>500000)return reply(413,{error:'Library registration is too large.'});
   const data=JSON.parse(event.body||'{}');
   if(!Array.isArray(data.movies)||data.movies.length>2000||data.movies.some(m=>!Number.isSafeInteger(m.id)||m.id<=0||typeof m.title!=='string'||typeof m.followRelease!=='boolean'))return reply(400,{error:'Invalid film registration.'});
   if(data.series!==undefined&&(!Array.isArray(data.series)||data.series.length>300||data.series.some(r=>!TV.valid(r))))return reply(400,{error:'Invalid TV registration.'});
   library={series:data.series===undefined?(library.series||[]):TV.normalize(data.series),movies:[...new Map(data.movies.map(m=>[m.id,{id:m.id,title:m.title.slice(0,200),followRelease:m.followRelease}])).values()],services:Array.isArray(data.services)?data.services.filter(s=>typeof s==='string'&&s.length<60).slice(0,30):library.services,registeredAt:Date.now()};
   await store.setJSON('library',library);
  }
  const saved=await store.get('snapshots',{type:'json'})||{films:{}};
  if(event.httpMethod==='POST'&&process.env.URL&&Date.now()-(saved.generatedAt||0)>6*3600000){
   try{await fetch(process.env.URL+'/.netlify/functions/rewind-library-refresh-background',{method:'POST',signal:AbortSignal.timeout(2500)});}catch{}
  }
  return reply(200,{registeredAt:library.registeredAt||null,generatedAt:saved.generatedAt||null,count:library.movies.length,seriesCount:(library.series||[]).length,series:(library.series||[]).map(r=>saved.series?.[r.id]).filter(Boolean),followed:library.movies.filter(m=>m.followRelease).length,films:library.movies.map(m=>saved.films?.[m.id]).filter(Boolean),schedule:'Followed releases every six hours; other films rotate through 24 checks per run.'});
 }catch{return reply(503,{error:'Background availability is temporarily unavailable. Your saved films are unchanged.'});}
};
