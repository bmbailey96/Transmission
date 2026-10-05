const {connectLambda,getStore}=require('@netlify/blobs');
const {refreshCinema}=require('../../lib/rewind/cinema');
exports.config={schedule:'0 */6 * * *'};
exports.handler=async event=>{connectLambda(event);const store=getStore({name:'rewind-cinema'});const previous=await store.get('calendar',{type:'json'});await store.setJSON('calendar',await refreshCinema(previous));return {statusCode:200,body:'Calendar checked'};};
