const {connectLambda,getStore}=require('@netlify/blobs');
const {refreshCinema}=require('../../lib/rewind/cinema');
exports.handler=async event=>{connectLambda(event);const store=getStore({name:'rewind-cinema'});const previous=await store.get('calendar',{type:'json'});if(previous&&Date.now()-previous.generatedAt<3*60000)return {statusCode:200};await store.setJSON('calendar',await refreshCinema(previous));return {statusCode:200};};
