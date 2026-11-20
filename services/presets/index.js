const { fetchOrdersInRange } = require('../orderService');
const { loadEnrichedOrder } = require('../orderEnrichment');
const orderCache = require('../orderCache');
const { promisePool } = require('../../utils/async');
const { throwIfCanceled } = require('../../utils/cancel');
const { parseDateOnly, dayStartUtc, dayEndUtc, zonedDateString, addDays } = require('../../utils/timezone');
const { STORE_ROLES, resolveStoreRoles } = require('./common');
const { renderWorkbook } = require('./workbook');

const PRESETS = [
  require('./productStoreReport'),
  require('./redemptionStoreReport'),
  require('./summaryReport'),
  require('./weeklyTrackingReports'),
];
const byId = new Map(PRESETS.map(p => [p.id, p]));

// Shipments can belong to orders placed before January 1, so tracking sheets look back this far.
const TRACKING_LOOKBACK_DAYS = Math.max(0, Number(process.env.PRESET_TRACKING_LOOKBACK_DAYS) || 120);
const ENRICH_CONCURRENCY = 5;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function listPresets() {
  const roles = resolveStoreRoles();
  return PRESETS.map(p => {
    const stores = Object.entries(p.stores).map(([role, need]) => ({
      role, roleLabel: STORE_ROLES[role], required: need.required,
      storeKey: roles[role] ? roles[role].storeKey : null,
      storeLabel: roles[role] ? roles[role].label : null,
    }));
    return {
      id: p.id, title: p.title, description: p.description, rangeHelp: p.rangeHelp, stores,
      available: stores.every(s => !s.required || s.storeKey),
    };
  });
}

function validatePresetRequest(body = {}) {
  const preset = byId.get(body.preset);
  if (!preset) throw httpError(400, `Unknown report format '${String(body.preset)}'.`);
  if (!parseDateOnly(body.start) || !parseDateOnly(body.end)) {
    throw httpError(400, 'Start and end must be valid dates (YYYY-MM-DD).');
  }
  if (body.end < body.start) throw httpError(400, 'End date must be on or after the start date.');
  const roles = resolveStoreRoles();
  const missing = Object.entries(preset.stores).filter(([role, need]) => need.required && !roles[role]);
  if (missing.length) {
    throw httpError(400, `${preset.title} needs the ${missing.map(([role]) => STORE_ROLES[role]).join(' and ')}, which is not configured on this server.`);
  }
  return { preset: preset.id, start: body.start, end: body.end };
}

function rangesFor(request) {
  const year = request.end.slice(0, 4);
  return {
    selected: { start: request.start, end: request.end },
    ytd: { start: `${year}-01-01`, end: request.end },
  };
}

function fetchStartFor(kind, ranges) {
  const earliest = [ranges.selected.start, kind === 'selected' ? null : ranges.ytd.start].filter(Boolean).sort()[0];
  return kind === 'tracking' ? addDays(earliest, -TRACKING_LOOKBACK_DAYS) : earliest;
}

async function loadStoreOrders(role, target, fetchStart, end, { isCanceled, onProgress }) {
  const label = target.label;
  const report = message => typeof onProgress === 'function' && onProgress({ phase: `preset-${role}`, message });
  report(`Fetching ${label} orders placed ${fetchStart} to ${end}.`);
  const { orders, storeOpts } = await fetchOrdersInRange({
    storeKey: target.storeKey, store: target.store, startDate: dayStartUtc(fetchStart), endDate: dayEndUtc(end),
  }, { isCanceled });
  let done = 0;
  const before = orderCache.getStats();
  const enriched = await promisePool(orders, async order => {
    throwIfCanceled(isCanceled, 'Report job canceled while loading order details.');
    const entry = await loadEnrichedOrder(order, storeOpts, { isCanceled });
    done += 1;
    if (done % 25 === 0 || done === orders.length) report(`Loaded ${done} of ${orders.length} ${label} orders.`);
    return entry;
  }, ENRICH_CONCURRENCY, { stopOnError: true });
  const after = orderCache.getStats();
  return {
    storeKey: target.storeKey, label, orders: enriched,
    fetched: { from: fetchStart, to: end, orders: orders.length, fromCache: after.hits - before.hits },
  };
}

async function runPreset(request, { isCanceled, onProgress, maxRows = Infinity } = {}) {
  const preset = byId.get(request.preset);
  if (!preset) throw httpError(400, `Unknown report format '${String(request.preset)}'.`);
  const ranges = rangesFor(request);
  const roles = resolveStoreRoles();
  const stores = {};
  const warnings = [];
  for (const [role, need] of Object.entries(preset.stores)) {
    throwIfCanceled(isCanceled, 'Report job canceled.');
    const target = roles[role];
    if (!target) {
      if (need.required) throw httpError(400, `${preset.title} needs the ${STORE_ROLES[role]}, which is not configured on this server.`);
      stores[role] = null;
      warnings.push(`The ${STORE_ROLES[role]} is not configured on this server, so its sheets are empty.`);
      continue;
    }
    stores[role] = await loadStoreOrders(role, target, fetchStartFor(need.fetch, ranges), ranges.selected.end, { isCanceled, onProgress });
    const total = Object.values(stores).filter(Boolean).reduce((n, s) => n + s.orders.length, 0);
    if (total > maxRows) throw httpError(400, `Report exceeds the maximum of ${maxRows} rows. Narrow the date range and try again.`);
  }
  throwIfCanceled(isCanceled, 'Report job canceled.');
  if (typeof onProgress === 'function') onProgress({ phase: 'preset-build', message: `Building ${preset.title}.` });
  const generatedAt = zonedDateString(new Date());
  const built = preset.build({ stores, ranges, generatedAt });
  const rowCounts = Object.fromEntries(built.sheets.map(s => [s.name, s.rows.length]));
  const rows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
  if (rows > maxRows) throw httpError(400, `Report exceeds the maximum of ${maxRows} rows. Narrow the date range and try again.`);
  return {
    preset: { id: preset.id, title: preset.title },
    sheets: built.sheets,
    meta: {
      reportLevel: 'preset', preset: preset.id, title: preset.title, generatedAt, ranges,
      orders: Object.values(stores).filter(Boolean).reduce((n, s) => n + s.orders.length, 0),
      rows, rowCounts, summary: built.summary || null,
      stores: Object.fromEntries(Object.entries(stores).map(([role, s]) => [role, s && { storeKey: s.storeKey, label: s.label, ...s.fetched }])),
      warnings: warnings.concat(built.warnings || []),
    },
  };
}

function workbookFilename(result) {
  const [y, m, d] = String(result.meta.generatedAt).split('-');
  return `${result.preset.title} ${m}${d}${y}.xlsx`;
}

async function renderPresetWorkbook(result) {
  return { buffer: await renderWorkbook(result), filename: workbookFilename(result) };
}

module.exports = { PRESETS, listPresets, validatePresetRequest, runPreset, renderPresetWorkbook, rangesFor, fetchStartFor };
