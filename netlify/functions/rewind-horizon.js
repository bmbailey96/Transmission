const {connectLambda,getStore}=require('@netlify/blobs');
const snapshot=require('../../lib/rewind/horizon-snapshot.json');
exports.handler=async event=>{const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};if(event.httpMethod!=='GET')return {statusCode:405,headers,body:'{}'};
 let data;try{connectLambda(event);data=await getStore({name:'rewind-horizon'}).get('feed',{type:'json'});}catch{}
 data=data||snapshot;const expired=Date.now()-(data.checkedAt||0)>7*86400000;return {statusCode:200,headers,body:JSON.stringify({...data,items:expired?[]:data.items,stale:data.stale||Date.now()-(data.checkedAt||0)>36*3600000})};};
