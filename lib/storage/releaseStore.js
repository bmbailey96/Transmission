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
  return getStore({ name: STORE_NAME });
}

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

async function getAllReleases() {
  const store = getReleaseStore();
  const { blobs } = await store.list();
  const releases = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return releases.filter(Boolean);
}

module.exports = { upsertRelease, getAllReleases, releaseKey };
