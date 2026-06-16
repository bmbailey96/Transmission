const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'seen-items';

function keyFor(link) {
  return Buffer.from(String(link || '')).toString('base64url').slice(0, 180);
}

function getSeenStore() {
  return getStore({ name: STORE_NAME });
}

async function hasSeenItem(link) {
  const store = getSeenStore();
  try {
    const value = await store.get(keyFor(link));
    return value !== null;
  } catch (err) {
    return false;
  }
}

async function markItemSeen(link) {
  const store = getSeenStore();
  await store.set(keyFor(link), new Date().toISOString());
}

module.exports = { hasSeenItem, markItemSeen };
