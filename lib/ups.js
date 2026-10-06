const nodeFetch = require('node-fetch');
const { logWarn } = require('../utils/logger');
const { promisePool } = require('../utils/async');
const { throwIfCanceled } = require('../utils/cancel');

const UPS_EXTRA_COLUMNS = [
  'UPS Last Scan', 'UPS Delivered Date', 'UPS Delivered Time', 'UPS Received By', 'UPS Delivery Location',
  'UPS Origin', 'UPS Destination', 'UPS Reference Numbers', 'UPS Package Count', 'UPS Additional Services',
  'UPS Dimensions', 'UPS Alternate Tracking #',
];
const UPS_COLUMNS = ['UPS Status', 'UPS Service', 'UPS Weight', 'Expected Delivery Date'].concat(UPS_EXTRA_COLUMNS);
const UPS_TRACKING_RE = /^1Z[0-9A-Z]{16}$/i;
const FINAL_CACHE_MS = 24 * 3600 * 1000;
const PENDING_CACHE_MS = 15 * 60 * 1000;

const cache = new Map();
let tokenState = { token: null, expiresAt: 0 };

function baseUrl() {
  return process.env.UPS_API_BASE || 'https://onlinetools.ups.com';
}

function isConfigured() {
  return Boolean(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET);
}

function isUpsTracking(value) {
  return UPS_TRACKING_RE.test(String(value || '').trim());
}

async function getToken(fetchImpl) {
  if (tokenState.token && tokenState.expiresAt > Date.now() + 60000) return tokenState.token;
  const basic = Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64');
  const res = await fetchImpl(`${baseUrl()}/security/v1/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`UPS sign-in failed (HTTP ${res.status}). Check UPS_CLIENT_ID and UPS_CLIENT_SECRET.`);
  const data = await res.json();
  tokenState = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenState.token;
}

function formatUpsDate(yyyymmdd) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(yyyymmdd || ''));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

function formatUpsTime(hhmmss) {
  const m = /^(\d{2})(\d{2})/.exec(String(hhmmss || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

function placeText(addr) {
  if (!addr) return '';
  return [addr.city, addr.stateProvince, addr.countryCode].filter(Boolean).join(', ');
}

function extractExtra(pkg) {
  const activity = Array.isArray(pkg.activity) ? pkg.activity : [];
  const last = activity[0];
  const lastScan = last && last.date ? `${formatUpsDate(last.date)} ${formatUpsTime(last.time)}`.trim() : '';
  const delivered = (pkg.deliveryDate || []).find((d) => d.type === 'DEL');
  const delTime = (Array.isArray(pkg.deliveryTime) ? pkg.deliveryTime : [pkg.deliveryTime]).find((t) => t && t.type === 'DEL');
  const info = pkg.deliveryInformation || {};
  const addresses = Array.isArray(pkg.packageAddress) ? pkg.packageAddress : [];
  const addrOf = (type) => placeText((addresses.find((a) => String(a.type || '').toUpperCase() === type) || {}).address);
  const d = pkg.dimension;
  return [
    lastScan,
    formatUpsDate(delivered && delivered.date),
    formatUpsTime(delTime && delTime.endTime),
    info.receivedBy || '',
    info.location || '',
    addrOf('ORIGIN'),
    addrOf('DESTINATION'),
    (pkg.referenceNumber || []).map((r) => r && r.number).filter(Boolean).join('; '),
    pkg.packageCount != null ? String(pkg.packageCount) : '',
    (pkg.additionalServices || []).join('; '),
    d && (d.length || d.width || d.height) ? `${d.length} x ${d.width} x ${d.height} ${String(d.unitOfDimension || '').toLowerCase()}`.trim() : '',
    (pkg.alternateTrackingNumber || []).map((a) => a && a.number).filter(Boolean).join('; '),
  ];
}

function parseTrackResponse(body) {
  const shipment = body && body.trackResponse && body.trackResponse.shipment && body.trackResponse.shipment[0];
  const pkg = shipment && shipment.package && shipment.package[0];
  if (!pkg) {
    const warning = shipment && shipment.warnings && shipment.warnings[0];
    return { status: warning ? warning.message : 'Not found', service: '', weight: '', delivery: '', final: false };
  }
  const status = (pkg.currentStatus && pkg.currentStatus.description) || (pkg.activity && pkg.activity[0] && pkg.activity[0].status && pkg.activity[0].status.description) || '';
  const delivered = (pkg.deliveryDate || []).find((d) => d.type === 'DEL');
  const scheduled = (pkg.deliveryDate || []).find((d) => d.type === 'SDD' || d.type === 'RDD');
  const w = pkg.weight;
  return {
    status,
    service: (pkg.service && pkg.service.description) || '',
    weight: w && w.weight ? `${w.weight} ${String(w.unitOfMeasurement || '').toLowerCase()}`.trim() : '',
    delivery: formatUpsDate((delivered || scheduled || {}).date),
    extra: extractExtra(pkg),
    final: Boolean(delivered),
  };
}

async function lookupTracking(trackingNumber, { fetchImpl = nodeFetch } = {}) {
  const key = String(trackingNumber).trim().toUpperCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const doFetch = async () => {
    const token = await getToken(fetchImpl);
    return fetchImpl(`${baseUrl()}/api/track/v1/details/${encodeURIComponent(key)}?locale=en_US&returnSignature=false`, {
      headers: { Authorization: `Bearer ${token}`, transId: `${Date.now()}`, transactionSrc: 'brightsites-exporter' },
    });
  };
  let res = await doFetch();
  if (res.status === 401) { tokenState = { token: null, expiresAt: 0 }; res = await doFetch(); }
  if (res.status === 429) throw new Error('UPS rate limit reached. Try again in a few minutes.');
  let value;
  if (res.status === 404) value = { status: 'Not found', service: '', weight: '', delivery: '', final: false };
  else if (!res.ok) throw new Error(`UPS tracking lookup failed (HTTP ${res.status}).`);
  else value = parseTrackResponse(await res.json());

  cache.set(key, { value, expires: Date.now() + (value.final ? FINAL_CACHE_MS : PENDING_CACHE_MS) });
  return value;
}

async function enrichRowsWithUps(rows, trackingIndex, { isCanceled, onProgress, fetchImpl, concurrency = 3 } = {}) {
  const unique = Array.from(new Set(rows.map((r) => String(r[trackingIndex] || '').trim()).filter(isUpsTracking)));
  const results = new Map();
  let done = 0;
  const failures = [];

  await promisePool(unique, async (num) => {
    throwIfCanceled(isCanceled, 'Report job canceled while looking up UPS tracking.');
    try {
      results.set(num, await lookupTracking(num, { fetchImpl }));
    } catch (err) {
      failures.push(err.message);
      results.set(num, { status: 'Lookup failed', service: '', weight: '', delivery: '' });
    }
    done += 1;
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'ups-tracking', message: `Looked up ${done} of ${unique.length} UPS tracking numbers.` });
    }
  }, concurrency);

  if (failures.length) {
    logWarn('lib/ups.enrichRowsWithUps', `${failures.length} UPS lookups failed`, { sample: failures[0] });
  }

  rows.forEach((row) => {
    const r = results.get(String(row[trackingIndex] || '').trim());
    const extra = (r && r.extra) || UPS_EXTRA_COLUMNS.map(() => '');
    row.push(r ? r.status : '', r ? r.service : '', r ? r.weight : '', r ? r.delivery : '', ...extra);
  });
  return { lookedUp: unique.length, failed: failures.length, firstError: failures[0] || null };
}

function resetForTests() {
  cache.clear();
  tokenState = { token: null, expiresAt: 0 };
}

module.exports = { UPS_COLUMNS, isConfigured, isUpsTracking, lookupTracking, enrichRowsWithUps, parseTrackResponse, resetForTests };
