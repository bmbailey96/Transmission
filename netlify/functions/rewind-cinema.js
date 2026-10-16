const {connectLambda,getStore}=require('@netlify/blobs');
const {refreshCinema,todayDenver}=require('../../lib/rewind/cinema');
exports.handler=async event=>{
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'};
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers,body:''};
 if(event.httpMethod!=='GET')return {statusCode:405,headers,body:JSON.stringify({error:'GET only'})};
 const week=event.queryStringParameters?.week,today=todayDenver();
 if(week&&(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week+'T12:00:00Z'))||new Date(week+'T12:00:00Z').toISOString().slice(0,10)!==week||Math.abs(Date.parse(week)-Date.parse(today))>366*86400000))return {statusCode:400,headers,body:JSON.stringify({error:'Select a valid calendar week within one year.'})};
 const start=week||today,key=week?'calendar-week-'+week:'calendar';
 try{connectLambda(event);const store=getStore({name:'rewind-cinema'});let data=await store.get(key,{type:'json'});if(!data||data.schema!==2||data.weekStart!==start||Date.now()-data.generatedAt>6*3600000||event.queryStringParameters?.refresh&&Date.now()-data.generatedAt>3*60000){data=await refreshCinema(data,{week:start});await store.setJSON(key,data);}return {statusCode:200,headers,body:JSON.stringify(data)};}catch{return {statusCode:503,headers,body:JSON.stringify({error:'Cinema calendar unavailable. Use the official listings links.'})};}
};
