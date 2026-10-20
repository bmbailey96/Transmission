const {tmdb,eventsFor}=require('./availability');
const Release=require('./release-model');
function valid(row){return !!row&&typeof row.id==='string'&&/^tv:[a-z0-9:_-]{1,180}$/i.test(row.id)&&Number.isSafeInteger(row.tmdbId)&&row.tmdbId>0&&typeof row.title==='string'&&row.title.trim().length>0&&typeof row.followRelease==='boolean'&&Number.isSafeInteger(row.season)&&row.season>=1&&row.season<=100&&(row.episode==null||Number.isSafeInteger(row.episode)&&row.episode>=0&&row.episode<=10000);}
function normalize(rows){return [...new Map(rows.map(r=>[r.id,{id:r.id,tmdbId:r.tmdbId,title:r.title.slice(0,200),mediaType:'tv',followRelease:r.followRelease,season:r.season,episode:r.episode??null}])).values()];}
function compose(row,detail,providers,services,today=new Date().toISOString().slice(0,10),at=Date.now()){
 if(!valid(row)||detail?.id!==row.tmdbId||!Array.isArray(detail.seasons)||!providers?.results)throw Error('Invalid TV source');
 const us=providers.results.US||{},link='https://www.themoviedb.org/tv/'+row.tmdbId;
 const target=detail.seasons.find(s=>s.season_number===row.season),future=target?.air_date>today;
 const events=future?[]:eventsFor(us,[],today,services).filter(e=>['subscription','free'].includes(e.kind)).map(e=>({...e,key:'tv:'+e.key,label:e.label+' · series listing; confirm season '+row.season,source:'TMDB TV US providers'}));
 const add=(key,date,label,kind)=>{if(!Release.date(date)||date<Release.addDays(today,-1)||date>Release.addDays(today,120))return;events.push({key:'tv:'+key+':'+date,kind,date,label:label+': '+date+' · catalog air date',link,source:'TMDB TV'});};
 for(const s of detail.seasons)if(s.season_number>=row.season&&s.season_number>0)add('season:'+s.season_number,s.air_date,'Season '+s.season_number+' premiere','tv-season');
 for(const e of [detail.next_episode_to_air,detail.last_episode_to_air])if(e&&e.season_number>=row.season&&(e.season_number>row.season||row.episode==null||e.episode_number>row.episode))add('episode:'+e.season_number+':'+e.episode_number,e.air_date,'Season '+e.season_number+', episode '+e.episode_number,'tv-episode');
 const names=[...new Map((us.flatrate||[]).map(p=>[p.provider_id,{id:p.provider_id,name:p.provider_name}])).values()];
 return {events:[...new Map(events.map(e=>[e.key,e])).values()],snapshot:{id:row.id,mediaType:'tv',tmdbId:row.tmdbId,detail,providers:names,providerURL:us.link||link,checkedAt:at}};
}
async function check(row,services,request=tmdb){const [detail,providers]=await Promise.all([request('/tv/'+row.tmdbId,{append_to_response:'credits,keywords'}),request('/tv/'+row.tmdbId+'/watch/providers')]);return compose(row,detail,providers,services);}
module.exports={valid,normalize,compose,check};
