// Temporary read-only inventory endpoint for the 2026 playlist cleanup.
const { getAccessToken } = require('../../lib/spotify/spotifyPlaylist');
const ID = '6B4LOoYt8gAu2EJJxhFM8M';
exports.handler = async function () {
  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const meta = await fetch(`https://api.spotify.com/v1/playlists/${ID}?fields=id,name,snapshot_id`, {headers}).then(r=>r.json());
    const entries = [];
    let url = `https://api.spotify.com/v1/playlists/${ID}/items?limit=100&fields=items(added_at,item(uri,name,duration_ms,album(id,name,artists(name)))),total,next`;
    while (url) {
      const r = await fetch(url,{headers});
      if (!r.ok) throw Error(`Spotify ${r.status}`);
      const p = await r.json();
      entries.push(...p.items.map(x=>({uri:x.item?.uri,title:x.item?.name,albumId:x.item?.album?.id,album:x.item?.album?.name,artist:x.item?.album?.artists?.map(a=>a.name).join(', '),addedAt:x.added_at,durationMs:x.item?.duration_ms})));
      url = p.next;
    }
    return {statusCode:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({name:meta.name,snapshotId:meta.snapshot_id,total:entries.length,entries})};
  } catch(e) {return {statusCode:502,body:JSON.stringify({error:e.message})};}
};
