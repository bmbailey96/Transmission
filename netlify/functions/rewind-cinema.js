const {connectLambda,getStore}=require('@netlify/blobs');
const {refreshCinema}=require('../../lib/rewind/cinema');
exports.handler=async event=>{
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'};
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers,body:''};
 if(event.httpMethod!=='GET')return {statusCode:405,headers,body:JSON.stringify({error:'GET only'})};
 try{connectLambda(event);const store=getStore({name:'rewind-cinema'});let data=await store.get('calendar',{type:'json'});if(!data||data.schema!==2||Date.now()-data.generatedAt>6*3600000||event.queryStringParameters?.refresh&&Date.now()-data.generatedAt>3*60000){data=await refreshCinema(data);await store.setJSON('calendar',data);}return {statusCode:200,headers,body:JSON.stringify(data)};}catch{return {statusCode:503,headers,body:JSON.stringify({error:'Cinema calendar unavailable. Use the official listings links.'})};}
};
