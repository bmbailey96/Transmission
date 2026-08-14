const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'releases';
const INDEX_KEY = '__index__';
// The Wikipedia backlog background job upserts up to 40 releases in one
// invocation via Promise.all (see BACKGROUND_MAX_PER_RUN in
// wikipedia-backlog-background.js), all racing to update this same index
// blob. A retry cap needs real headroom above that, and a small jittered
// backoff between attempts so losers don't immediately collide again on
// the next try, both were missing from the first pass and a concurrency
// test caught it: 20 concurrent upserts with no backoff exhausted an
// 8-attempt cap and threw instead of eventually landing.
const MAX_CAS_RETRIES = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function releaseKey(artist, title) {
  return `${slugify(artist)}__${slugify(title)}`;
}

function getReleaseStore() {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore({ name: STORE_NAME });
}

/**
 * The index is a single blob holding every release, keyed the same way the
 * individual per-release blobs are. Reading it is one Blobs request no
 * matter how large the store gets, which is the whole point: the old
 * getAllReleases() listed every key and then fetched each one individually,
 * and once the store passed a few hundred entries that was enough sequential
 * round-trips to blow straight through Netlify's function time limit. That's
 * the actual cause of the 502s on the feed and the discovery test page,
 * confirmed against real Netlify logs (60000ms, hit repeatedly, memory
 * completely normal, so it was round-trip count, not a crash or a payload
 * size limit).
 *
 * Run netlify/functions/build-release-index-trigger.js once after deploying
 * this to populate the index from whatever's already in the store under the
 * old scattered-blobs layout. Until that's run, getAllReleases() returns
 * nothing, since the index doesn't exist yet, not because the data's gone.
 */
async function readIndex(store) {
  const result = await store.getWithMetadata(INDEX_KEY, { type: 'json' });
  if (!result) return { data: {}, etag: undefined };
  return { data: result.data || {}, etag: result.etag };
}

/**
 * Updates one entry in the index using optimistic concurrency (Netlify
 * Blobs' onlyIfMatch/onlyIfNew), not a blind read-modify-write. Several
 * functions in this app upsert many releases in the same invocation via
 * Promise.all (the Wikipedia backlog batch does up to 40 at once, the
 * announced-date backfill does up to 25), and all of them would be racing
 * to update this same shared blob. A naive read-then-write would let later
 * writers silently stomp earlier ones. This retries against the latest
 * state instead, so concurrent upserts all land, they just cost an extra
 * round trip when they lose a race, which is a fine tradeoff since none of
 * the callers that upsert in bulk are on the user-facing timeout budget.
 */
async function mergeIntoIndex(store, key, mergeFn) {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { data: index, etag } = await readIndex(store);
    const existing = index[key] || null;
    const merged = mergeFn(existing);
    const nextIndex = { ...index, [key]: merged };

    const writeOptions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const result = await store.setJSON(INDEX_KEY, nextIndex, writeOptions);
    if (result.modified) return merged;
    // Someone else wrote the index between our read and our write. Back off
    // a random amount before retrying, so a whole batch of losers doesn't
    // immediately collide again on the very next attempt.
    await sleep(10 + Math.random() * 40);
  }
  throw new Error(
    `Could not update the release index after ${MAX_CAS_RETRIES} attempts, too much concurrent write pressure right now`
  );
}

/**
 * Saves or merges a release. Still writes the individual per-key blob too
 * (unchanged), so getRelease() stays a cheap single-key lookup exactly like
 * before. The index is what getAllReleases() and getKnownReleaseKeys() read
 * from now, kept in sync here rather than reconstructed from scratch on
 * every read.
 */
async function upsertRelease(release) {
  const store = getReleaseStore();
  const key = releaseKey(release.artist, release.albumTitle);

  const merged = await mergeIntoIndex(store, key, (existing) => ({
    ...existing,
    ...release,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  await store.setJSON(key, merged);
  return merged;
}

/**
 * Applies many small field patches to already-existing releases in a
 * single index read-modify-write, instead of one mergeIntoIndex() CAS loop
 * per patch. This exists because of a real crash: the discovery backfill
 * (runDiscoveryPass.js) can find dozens of already-known releases that are
 * missing a releaseDate in the same run, and originally patched each one
 * with its own upsertRelease() call, all firing concurrently via
 * Promise.all. Every one of those CAS loops does its own full read +
 * JSON-parse + JSON-stringify + write of the ENTIRE index (1700+ entries),
 * and under contention on one shared blob a batch that size means dozens
 * of full-index copies in flight and retrying at once, not just one. In a
 * regular (non-background) function with a fixed memory budget, that's
 * what produced Runtime.OutOfMemory: signal: killed, not the single extra
 * getAllReleases() read this same change also added. This does the whole
 * batch as one read, one set of in-memory merges, one write, so the cost
 * stays flat no matter how many patches are in the batch. Only patches
 * whose key already exists in the index are applied; anything not already
 * known is silently skipped; this is a patch operation, not an upsert.
 */
async function bulkPatchReleases(patches) {
  const store = getReleaseStore();
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { data: index, etag } = await readIndex(store);
    const nextIndex = { ...index };
    const applied = [];

    for (const patch of patches) {
      const key = releaseKey(patch.artist, patch.albumTitle);
      const existing = nextIndex[key];
      if (!existing) continue;
      const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      nextIndex[key] = merged;
      applied.push(merged);
    }

    if (!applied.length) return [];

    const writeOptions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const result = await store.setJSON(INDEX_KEY, nextIndex, writeOptions);
    if (result.modified) {
      // Individual per-key blobs are independent writes (no shared blob, so
      // no CAS/contention risk between them), safe to fire concurrently.
      await Promise.all(applied.map((release) => store.setJSON(releaseKey(release.artist, release.albumTitle), release)));
      return applied;
    }
    await sleep(10 + Math.random() * 40);
  }
  throw new Error(
    `Could not bulk-patch the release index after ${MAX_CAS_RETRIES} attempts, too much concurrent write pressure right now`
  );
}

async function getRelease(artist, title) {
  const store = getReleaseStore();
  const key = releaseKey(artist, title);
  try {
    return await store.get(key, { type: 'json' });
  } catch (err) {
    return null;
  }
}

async function getAllReleases() {
  const store = getReleaseStore();
  const { data: index } = await readIndex(store);
  return Object.values(index).filter(Boolean);
}

async function getKnownReleaseKeys() {
  const store = getReleaseStore();
  const { data: index } = await readIndex(store);
  return new Set(Object.keys(index));
}

/**
 * The old, slow full-store scan. Kept only for the one-time migration
 * (build-release-index-background.js) that populates the index from
 * whatever's already sitting in individual blobs from before this change.
 * Nothing else should call this, it's the exact pattern that was timing out.
 */
async function _rawScanAllReleases(store) {
  const keys = [];
  for await (const page of store.list({ paginate: true })) {
    keys.push(...page.blobs.map((b) => b.key));
  }

  const BATCH_SIZE = 50;
  const releases = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE).filter((k) => k !== INDEX_KEY);
    const batchResults = await Promise.all(batch.map((key) => store.get(key, { type: 'json' })));
    releases.push(...batchResults.filter(Boolean));
  }
  return releases;
}

/**
 * One-time migration: reads every release the old way (full scan of
 * individual blobs) and writes them into the index blob in one shot,
 * overwriting whatever's there. Safe to run more than once, it's rebuilding
 * from the same source blobs every time, not accumulating. Meant to be
 * called from a background function (15 minute budget), not anything on
 * the normal request path, since it's doing the exact slow scan this whole
 * change exists to get rid of, just the one time it's actually needed.
 */
async function rebuildIndexFromRawScan() {
  const store = getReleaseStore();
  const releases = await _rawScanAllReleases(store);

  const index = {};
  for (const release of releases) {
    if (!release || !release.artist || !release.albumTitle) continue;
    index[releaseKey(release.artist, release.albumTitle)] = release;
  }

  await store.setJSON(INDEX_KEY, index);
  return { scanned: releases.length, indexed: Object.keys(index).length };
}

module.exports = {
  upsertRelease,
  bulkPatchReleases,
  getRelease,
  getAllReleases,
  getKnownReleaseKeys,
  releaseKey,
  getReleaseStore,
  rebuildIndexFromRawScan,
};