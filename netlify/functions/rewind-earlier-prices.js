const {connectLambda,getStore}=require('@netlify/blobs');
const {lookupEarlierPrices}=require('../../lib/rewind/cheapcharts');
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
exports.handler=async event=>{
 const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
 if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
 const id=Number(event.queryStringParameters?.id);
 if(!Number.isSafeInteger(id)||id<=0||id>100000000)return reply(400,{error:'Invalid film ID'});
 try{connectLambda(event);return reply(200,await lookupEarlierPrices(id,{store:getStore({name:'rewind-earlier-prices'})}));}
 catch{return reply(503,{error:'Earlier prices could not be checked. No history is assumed.'});}
};
