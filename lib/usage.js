const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'usage.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

function readAll() {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  } catch (e) {
    console.warn('usage.readAll error', e.message);
    return {};
  }
}

function writeAll(obj) {
  try {
    ensureDir();
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn('usage.writeAll error', e.message);
  }
}

function increment(storeKey, delta = 1, date = new Date()) {
  if (!storeKey) return;
  const all = readAll();
  const mk = monthKey(date);
  all[mk] = all[mk] || {};
  all[mk][storeKey] = (all[mk][storeKey] || 0) + delta;
  writeAll(all);
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
  getMonth,
  getStore,
  reset,
  monthKey,
  metricsFor,
  readAll,
};
