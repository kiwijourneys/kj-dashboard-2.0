const NodeCache = require('node-cache');
const config = require('./config');

const cache = new NodeCache({
  stdTTL: config.cacheTtl,
  checkperiod: 120,
  useClones: false,
});

const NAMESPACES = {
  HUBSPOT: 'hs',
  GA4: 'ga4',
  GOOGLE_ADS: 'gads',
  META: 'meta',
  XERO: 'xero',
};

function buildKey(namespace, ...parts) {
  return `${namespace}:${parts.join(':')}`;
}

// In-flight request deduplication: if two requests arrive simultaneously for
// the same cache key before either has resolved, only one upstream call is made.
const _inflight = {};

async function getOrFetch(key, fetchFn, ttlOverride) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Another request already in flight for this key — share its promise
  if (_inflight[key]) return _inflight[key];

  _inflight[key] = (async () => {
    try {
      const data = await fetchFn();
      cache.set(key, data, ttlOverride ?? config.cacheTtl);
      return data;
    } finally {
      delete _inflight[key];
    }
  })();

  return _inflight[key];
}

function invalidate(key) {
  cache.del(key);
}

function invalidateNamespace(namespace) {
  const keys = cache.keys().filter(k => k.startsWith(`${namespace}:`));
  cache.del(keys);
}

function getStats() {
  return cache.getStats();
}

// Track last-synced timestamps per source
const syncTimestamps = {};

function recordSync(source) {
  syncTimestamps[source] = new Date().toISOString();
}

function getSyncTimestamps() {
  return { ...syncTimestamps };
}

module.exports = {
  cache,
  NAMESPACES,
  buildKey,
  getOrFetch,
  invalidate,
  invalidateNamespace,
  getStats,
  recordSync,
  getSyncTimestamps,
};
