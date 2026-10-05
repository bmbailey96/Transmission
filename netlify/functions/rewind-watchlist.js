const { connectLambda, getStore } = require('@netlify/blobs');
const {preference}=require('../../lib/rewind/release-model');
const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
exports.handler = async event => {
  const reply = (statusCode, data) => ({statusCode,headers,body:JSON.stringify(data)});
  if (event.httpMethod === 'OPTIONS') return reply(204,{});
  if (!['GET','POST'].includes(event.httpMethod)) return reply(405,{error:'Method not allowed'});
  try {
    // Reuse Rewind's existing GitHub sign-in. Never store or log the token.
    const authorization = event.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reply(401,{error:'Connect your GitHub account in Settings first.'});
    const userRes = await fetch('https://api.github.com/user',{headers:{Authorization:authorization,'User-Agent':'Rewind'},signal:AbortSignal.timeout(15000)});
    if (!userRes.ok || (await userRes.json()).login !== 'bmbailey96') return reply(403,{error:'This card belongs to bmbailey96.'});
    connectLambda(event);
    const store = getStore({name:'rewind-alerts'});
    const settings = await store.get('watchlist',{type:'json'}) || {enabled:true,movies:[{id:1204680,title:'Coyote vs. Acme'}]};
    if (event.httpMethod === 'GET') return reply(200,{...settings,email:'bmbailey96@gmail.com',configured:!!(process.env.RESEND_API_KEY && process.env.DIGEST_FROM_EMAIL),pricesConfigured:!!process.env.WATCHMODE_API_KEY});
    if ((event.body || '').length > 100000) return reply(413,{error:'Card is too large.'});
    const data = JSON.parse(event.body);
    if (typeof data.enabled !== 'boolean' || !Array.isArray(data.movies) || data.movies.length > 500) return reply(400,{error:'Invalid card.'});
    if (data.movies.some(m => !Number.isSafeInteger(m.id) || m.id <= 0 || typeof m.title !== 'string')) return reply(400,{error:'Invalid film.'});
    if(data.movies.some(m=>m.alert&&(!['any','mine','rental'].includes(m.alert.mode)||typeof m.alert.maxPrice!=='number'||!Number.isFinite(m.alert.maxPrice)||m.alert.maxPrice<0||m.alert.maxPrice>100)))return reply(400,{error:'Invalid film alert preference.'});
    if (data.enabled && !(process.env.RESEND_API_KEY && process.env.DIGEST_FROM_EMAIL)) return reply(503,{error:'Email service is not configured.'});
    const movies = [...new Map(data.movies.map(m => [m.id,{id:m.id,title:m.title.slice(0,200),alert:preference(m.alert)}])).values()];
    const services = Array.isArray(data.services) ? data.services.filter(s=>typeof s === 'string' && s.length < 60).slice(0,30) : settings.services;
    const next = {enabled:data.enabled,movies,...(services ? {services} : {}),updatedAt:new Date().toISOString()};
    await store.setJSON('watchlist',next);
    return reply(200,{ok:true,count:movies.length,email:'bmbailey96@gmail.com'});
  } catch (err) { return reply(500,{error:err.message}); }
};
