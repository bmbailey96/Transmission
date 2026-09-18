const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'transmission-v2';
const STATE_KEY = 'state';

function releaseKey(artist, title) {
  const clean = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${clean(artist)}__${clean(title)}`;
}

function emptyState() {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    releases: {},
    seenLinks: [],
    events: [],
    lastRun: null,
  };
}

function getStoreV2() {
  return getStore({ name: STORE_NAME });
}

async function getState() {
  const state = await getStoreV2().get(STATE_KEY, { type: 'json' }).catch(() => null);
  return state && state.version === 2 ? state : emptyState();
}

async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await getStoreV2().setJSON(STATE_KEY, state);
  return state;
}

function addEvent(state, type, text, detail = null) {
  state.events = state.events || [];
  state.events.push({ at: new Date().toISOString(), type, text, detail });
  while (state.events.length > 80) state.events.shift();
}

function allReleases(state) {
  return Object.values((state && state.releases) || {}).filter(Boolean);
}

module.exports = { releaseKey, getState, saveState, addEvent, allReleases };
