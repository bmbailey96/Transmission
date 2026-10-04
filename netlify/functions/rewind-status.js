const {connectLambda,getStore}=require('@netlify/blobs');
exports.handler=async event=>{
 connectLambda(event);
 const store=getStore({name:'rewind-alerts'});
 const settings=await store.get('watchlist',{type:'json'});
 const receipt=await store.get('receipt',{type:'json'});
 return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({configured:!!(process.env.RESEND_API_KEY&&process.env.DIGEST_FROM_EMAIL),enabled:settings?.enabled??true,tracked:settings?.movies?.length??1,lastCheck:receipt?.checkedAt||null,lastEmail:receipt?.emailedAt||null})};
};
