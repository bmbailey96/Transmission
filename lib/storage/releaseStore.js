const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'releases';

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
  // Falls back to automatic detection if these aren't set, so nothing breaks
  // before they're configured. Once they are, every function sharing this
  // store stops depending on Netlify's auto-injection working correctly on
  // every deploy, which is the thing that's been flaking.
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore({ name: STORE_NAME });
}

/**
 * Saves or merges a release. If something's already stored under this artist
 * and title (found again by a different source, or re-extracted on a later
 * run), the new fields merge in on top rather than blindly overwriting, and
 * discoveredAt is preserved from whenever it was actually first found.
 */
async function upsertRelease(release) {
  const store = getReleaseStore();
  const key = releaseKey(release.artist, release.albumTitle);

  let existing = null;
  try {
    existing = await store.get(key, { type: 'json' });
  } catch (err) {
    existing = null;
  }

  const merged = {
    ...existing,
    ...release,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await store.setJSON(key, merged);
  return merged;
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

async function listAllKeys() {
  const store = getReleaseStore();
  const keys = [];
  for await (const page of store.list({ paginate: true })) {
    keys.push(...page.blobs.map((b) => b.key));
  }
  return keys;
}

async function getKnownReleaseKeys() {
  return new Set(await listAllKeys());
}

async function getAllReleases() {
  const store = getReleaseStore();
  const keys = await listAllKeys();
  // Reading every key with one unbounded Promise.all worked fine at a few
  // hundred entries, but firing 1000+ concurrent blob reads from a single
  // invocation is enough to crash the function runtime outright once the
  // store grows past that. Batching keeps memory and open connections
  // bounded regardless of how large the store gets.
  const BATCH_SIZE = 50;
  const releases = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((key) => store.get(key, { type: 'json' })));
    releases.push(...batchResults);
  }
  return releases.filter(Boolean);
}

module.exports = { upsertRelease, getRelease, getAllReleases, getKnownReleaseKeys, releaseKey };
