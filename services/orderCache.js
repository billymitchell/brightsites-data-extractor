// In-memory cache of fully enriched orders (order + line items + shipments).
// Entries are reused only while the order's updated_at from the order list is unchanged,
// so new shipments or edits are refetched. Nothing is written to disk: storing customer
// order data at rest needs client approval. A persistent store can replace this module
// later by implementing the same get/set/clear/stats interface.

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const state = {
  enabled: !process.env.NODE_TEST_CONTEXT && process.env.ORDER_CACHE !== 'off',
  maxEntries: Math.max(1, Number(process.env.ORDER_CACHE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES),
  ttlMs: Math.max(1000, Number(process.env.ORDER_CACHE_TTL_MS) || DEFAULT_TTL_MS),
  now: () => Date.now(),
};
const entries = new Map();
const stats = { hits: 0, misses: 0 };

function cacheKey(scope, orderId) {
  return `${scope}\u0000${orderId}`;
}

function get(scope, orderId, updatedAt) {
  if (!state.enabled || !updatedAt) return null;
  const key = cacheKey(scope, orderId);
  const entry = entries.get(key);
  if (!entry || entry.updatedAt !== String(updatedAt) || state.now() - entry.storedAt > state.ttlMs) {
    if (entry) entries.delete(key);
    stats.misses += 1;
    return null;
  }
  // Refresh recency for LRU eviction.
  entries.delete(key);
  entries.set(key, entry);
  stats.hits += 1;
  return entry.value;
}

function set(scope, orderId, updatedAt, value) {
  if (!state.enabled || !updatedAt) return;
  const key = cacheKey(scope, orderId);
  entries.delete(key);
  entries.set(key, { updatedAt: String(updatedAt), storedAt: state.now(), value });
  while (entries.size > state.maxEntries) entries.delete(entries.keys().next().value);
}

function clear() {
  entries.clear();
  stats.hits = 0;
  stats.misses = 0;
}

function configure(options = {}) {
  Object.assign(state, options);
  if (!state.enabled) entries.clear();
}

function getStats() {
  return { enabled: state.enabled, entries: entries.size, maxEntries: state.maxEntries, ...stats };
}

module.exports = { get, set, clear, configure, getStats };
