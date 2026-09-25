#!/usr/bin/env node
// Run with the same Spotify environment variables as Transmission.
// Default is read-only. --apply requires a prior report's snapshot ID.
const fs = require('node:fs');
const { getAccessToken } = require('../lib/spotify/spotifyPlaylist');
const { picks } = require('../data/curated2026');
const PLAYLIST_ID = process.env.SPOTIFY_PLAYLIST_ID || '6B4LOoYt8gAu2EJJxhFM8M';
const API = 'https://api.spotify.com/v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const confirmed = new Set(picks.map(x => `${clean(x.artist)}|${clean(x.title)}`));

async function request(token, path, init = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' } });
    if (r.ok) return r.status === 204 ? null : r.json();
    if (r.status === 429 || r.status >= 500) {
      const wait = r.status === 429 ? Math.max(1, Number(r.headers.get('retry-after')) || 1) * 1000 : (attempt + 1) * 1000;
      if (attempt < 3 && wait <= 300000) { await sleep(wait); continue; }
    }
    throw Error(`Spotify ${init.method || 'GET'} ${path}: ${r.status} ${await r.text()}`);
  }
}
async function entries(token) {
  let path = `/playlists/${PLAYLIST_ID}/items?limit=100&fields=items(added_at,item(uri,name,duration_ms,album(id,name,artists(name)),artists(name))),total,next`;
  const all = [];
  while (path) {
    const page = await request(token, path);
    all.push(...page.items.map(x => ({ addedAt:x.added_at, uri:x.item?.uri, name:x.item?.name,
      durationMs:x.item?.duration_ms, albumId:x.item?.album?.id, album:x.item?.album?.name,
      artist:x.item?.album?.artists?.map(a=>a.name).join(', ') || x.item?.artists?.map(a=>a.name).join(', ') })));
    path = page.next ? page.next.replace(API, '') : null;
  }
  return all;
}
function propose(items, releases) {
  const byAlbum = new Map();
  for (const r of releases) if (r.spotify?.albumId && r.lifecycle === 'released' && r.score >= 85 &&
      !confirmed.has(`${clean(r.artist)}|${clean(r.albumTitle)}`)) byAlbum.set(r.spotify.albumId, r);
  const groups = new Map();
  for (const item of items) if (item.uri && item.albumId) {
    const group = groups.get(item.albumId) || []; group.push(item); groups.set(item.albumId, group);
  }
  const eligible = [...groups].filter(([id])=>byAlbum.has(id)).map(([id,tracks])=>({ r:byAlbum.get(id), tracks }));
  eligible.sort((a,b)=>b.r.score-a.r.score || (b.r.releaseDate||'').localeCompare(a.r.releaseDate||''));
  const keep = eligible.slice(0,50).map(({r,tracks})=>{
    const named = (r.standoutTracks||[]).map(clean);
    const pick = tracks.find(t=>named.includes(clean(t.name))) || tracks.find(t=>t.durationMs>=90000) || tracks[0];
    return { artist:r.artist, album:r.albumTitle, score:r.score, uri:pick.uri, track:pick.name };
  });
  return { keep, removeCount:items.length-keep.length, excludedAlbums:groups.size-eligible.length };
}
async function main() {
  const token = await getAccessToken();
  const playlist = await request(token, `/playlists/${PLAYLIST_ID}?fields=id,name,snapshot_id,owner(id)`);
  const all = await entries(token);
  const feed = await fetch(process.env.TRANSMISSION_FEED_URL || 'https://transmissionalbum.netlify.app/.netlify/functions/v2-feed').then(r=>r.json());
  const plan = propose(all, feed.releases||[]);
  const report = { at:new Date().toISOString(), playlistId:PLAYLIST_ID, name:playlist.name, snapshotId:playlist.snapshot_id,
    total:all.length, uniqueAlbums:new Set(all.map(x=>x.albumId).filter(Boolean)).size, ...plan, entries:all };
  const output = process.env.SPOTIFY_AUDIT_OUTPUT || 'spotify-audit.json';
  fs.writeFileSync(output, JSON.stringify(report,null,2));
  console.log(`Audited ${all.length} tracks; ${report.uniqueAlbums} albums; proposed keep ${plan.keep.length}, archive ${plan.removeCount}. Wrote ${output}.`);
  if (!process.argv.includes('--apply')) return;
  const expected = process.env.SPOTIFY_EXPECTED_SNAPSHOT;
  if (!expected || expected !== playlist.snapshot_id) throw Error('Snapshot changed or SPOTIFY_EXPECTED_SNAPSHOT is missing; review a fresh report.');
  if (all.length < 100 || plan.keep.length > 50) throw Error('Unexpected playlist shape; no changes made.');
  const archive = await request(token, '/me/playlists', { method:'POST',body:JSON.stringify({name:`Transmission — Archive ${new Date().toISOString().slice(0,10)}`,description:`Full ${all.length}-track copy before the smaller discovery queue.`,public:false}) });
  for (let i=0;i<all.length;i+=100) await request(token, `/playlists/${archive.id}/items`, {method:'POST',body:JSON.stringify({uris:all.slice(i,i+100).map(x=>x.uri)})});
  const archived = await entriesFor(token, archive.id);
  if (archived !== all.length) throw Error(`Archive has ${archived}/${all.length} tracks; original untouched. Archive: ${archive.id}`);
  await request(token, `/playlists/${PLAYLIST_ID}/items`, {method:'PUT',body:JSON.stringify({uris:plan.keep.map(x=>x.uri)})});
  console.log(`Archived ${archived} tracks at https://open.spotify.com/playlist/${archive.id}; active playlist now has ${plan.keep.length}.`);
}
async function entriesFor(token,id) { const p=await request(token,`/playlists/${id}/items?limit=1&fields=total`);return p.total; }
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
