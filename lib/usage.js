const fs = require('fs');
const path = require('path');
const { logError } = require('../utils/logger');

// node --test sets NODE_TEST_CONTEXT; tests must never touch the real usage counts.
const FILE = process.env.USAGE_FILE || (process.env.NODE_TEST_CONTEXT
  ? path.join(require('os').tmpdir(), `brightsites-usage-test-${process.pid}.json`)
  : path.join(__dirname, '..', 'data', 'usage.json'));
const DATA_DIR = path.dirname(FILE);
let cachedUsage = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

function readAll() {
  if (cachedUsage) return cachedUsage;
  try {
    ensureDir();
    const usageData = fs.existsSync(FILE)
      ? JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}')
      : {};
    if (!usageData || typeof usageData !== 'object' || Array.isArray(usageData)) {
      throw new Error('Usage data must contain a JSON object.');
    }
    cachedUsage = usageData;
    return cachedUsage;
  } catch (e) {
    logError('lib/usage.readAll', e, { file: FILE });
    return {};
  }
}

function writeAll(obj) {
  try {
    ensureDir();
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, FILE);
    cachedUsage = obj;
  } catch (e) {
    logError('lib/usage.writeAll', e, { file: FILE });
  }
}

// Counts change on every BrightSites request; persist them in batches instead of
// rewriting the file synchronously each time. Reads always use the in-memory copy.
const FLUSH_DELAY_MS = 2000;
let flushTimer = null;

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (cachedUsage) writeAll(cachedUsage);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

process.once('exit', () => { if (flushTimer) flush(); });

function increment(storeKey, delta = 1, date = new Date()) {
  if (!storeKey) return;
  const all = readAll();
  cachedUsage = all;
  const mk = monthKey(date);
  all[mk] = all[mk] || {};
  all[mk][storeKey] = (all[mk][storeKey] || 0) + delta;
  scheduleFlush();
}

function getMonth(mk = monthKey()) {
  const all = readAll();
  return all[mk] || {};
}

function getStore(storeKey, mk = monthKey()) {
  return getMonth(mk)[storeKey] || 0;
}

function reset(mk = monthKey()) {
  const all = readAll();
  all[mk] = {};
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  writeAll(all);
}

function metricsFor(count, { freeLimit, reserve, rate }) {
  const usable = Math.max(0, freeLimit - reserve);
  const usedWithinUsable = Math.min(count, usable);
  const remainingBeforeReserve = Math.max(0, usable - count);
  const remainingTotalFree = Math.max(0, freeLimit - count);
  const overageCalls = Math.max(0, count - freeLimit);
  const overageCost = +(overageCalls * rate).toFixed(2);
  return { count, freeLimit, reserve, usableBeforeReserve: usable, usedWithinUsable, remainingBeforeReserve, remainingTotalFree, overageCalls, rate, overageCost };
}

module.exports = {
  increment,
  flush,
  getMonth,
  getStore,
  reset,
  monthKey,
  metricsFor,
  readAll,
};
