const { fetchAllPages } = require('../lib/brightSites');
const { deduplicateOrders } = require('./reportFields');
const { normalizeReportLevel } = require('../config/report');
const { getConfiguredStores } = require('../config/stores');
const { logWarn } = require('../utils/logger');
const { throwIfCanceled } = require('../utils/cancel');
const { zonedTimeToUtc } = require('../utils/timezone');

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function parseStatuses(status) {
  if (!status) return [];
  if (Array.isArray(status)) return status.map((x) => String(x).trim()).filter(Boolean);
  if (typeof status === 'string') return status.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

async function fetchOrders(params, statuses, storeOpts, options = {}) {
  const { onProgress, isCanceled } = options;

  if (statuses.length > 1) {
    const baseParams = Object.assign({}, params);
    const lists = await Promise.all(
      statuses.map((status, index) => {
        if (typeof onProgress === 'function') {
          onProgress({
            phase: 'fetching-orders',
            currentStatus: status,
            statusesProcessed: index,
            statusesTotal: statuses.length,
            message: `Fetching orders for status ${status} (${index + 1}/${statuses.length}).`,
          });
        }
        return fetchAllPages(
          '/orders',
          Object.assign({}, baseParams, { status }),
          200,
          Object.assign({}, storeOpts, {
            isCanceled,
            onPage: ({ totalCount, page }) => {
              if (typeof onProgress !== 'function') return;
              onProgress({
                phase: 'fetching-orders',
                currentStatus: status,
                statusesProcessed: index,
                statusesTotal: statuses.length,
                page,
                ordersFetched: totalCount,
                message: `Fetching orders for status ${status} (${index + 1}/${statuses.length}). ${totalCount} orders found so far.`,
              });
            },
          })
        );
      })
    );
    if (options.reportLevel === 'order' || options.reportLevel === 'both') {
      return deduplicateOrders(lists.flat());
    }
    const dedup = new Map();
    const keyOf = (order) => String(order && (order.order_id || order.id || order.orderNumber || order.number || ''));
    lists.flat().forEach((order) => {
      const key = keyOf(order);
      if (key && !dedup.has(key)) dedup.set(key, order);
    });
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'orders-fetched',
        ordersTotal: dedup.size,
        statusesProcessed: statuses.length,
        statusesTotal: statuses.length,
        message: `Fetched ${dedup.size} unique orders across ${statuses.length} statuses.`,
      });
    }
    return Array.from(dedup.values());
  }

  if (statuses.length === 1) params.status = statuses[0];
  const orders = await fetchAllPages('/orders', params, 200, Object.assign({}, storeOpts, {
    isCanceled,
    onPage: ({ totalCount, page }) => {
      if (typeof onProgress !== 'function') return;
      onProgress({
        phase: 'fetching-orders',
        currentStatus: statuses[0] || '',
        page,
        ordersFetched: totalCount,
        message: totalCount > 0
          ? `Fetched ${totalCount} matching orders so far.`
          : 'Fetching matching orders.',
      });
    },
  }));
  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'orders-fetched',
      ordersTotal: orders.length,
      message: `Fetched ${orders.length} matching orders.`,
    });
  }
  return orders;
}

function validateRunRequest(body = {}) {
  const reportLevel = normalizeReportLevel(body.reportLevel);
  if (reportLevel === 'order' && body.includeUps === true) {
    throw createHttpError(400, 'UPS tracking is available in Shipment Level or Both tables.');
  }
  const storeKey = body.storeKey;
  const stores = getConfiguredStores();
  if (!storeKey) {
    throw createHttpError(400, 'storeKey is required. Call GET /api/stores to list available stores and include storeKey in the request body.');
  }

  const store = stores[storeKey];
  if (!store) {
    throw createHttpError(400, `storeKey '${String(storeKey)}' not found. Available stores: ${Object.keys(stores).join(', ')}`);
  }

  if (!body.start || !body.end) {
    throw createHttpError(400, 'Both start and end dates are required to prevent returning all data.');
  }

  // Date-only values are whole business days in REPORT_TIMEZONE, not UTC days.
  const parseBoundary = (value, endOfDay) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!m) return new Date(value);
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return new Date(NaN);
    return zonedTimeToUtc(endOfDay
      ? { year, month, day, hour: 23, minute: 59, second: 59, ms: 999 }
      : { year, month, day });
  };
  const startDate = parseBoundary(body.start, false);
  const endDate = parseBoundary(body.end, true);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createHttpError(400, 'Start and end must be valid dates.');
  }
  if (endDate < startDate) {
    throw createHttpError(400, 'End date must be on or after the start date.');
  }

  const storeOpts = { subdomain: store.subdomain, token: store.token, storeKey };
  const params = {};
  const dateFilterType = 'created_at';
  params[`${dateFilterType}_from`] = startDate.toISOString();
  params[`${dateFilterType}_to`] = endDate.toISOString();

  return {
    store,
    reportLevel,
    storeKey,
    storeOpts,
    params,
    statuses: parseStatuses(body.status),
  };
}

async function getRunContext(body = {}, options = {}) {
  const { params, statuses, storeOpts, reportLevel } = validateRunRequest(body);
  const { onProgress, isCanceled } = options;

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'fetching-orders',
      message: 'Fetching matching orders from BrightSites.',
    });
  }

  throwIfCanceled(isCanceled, 'Report job canceled before fetching orders.');
  const fetched = await fetchOrders(params, statuses, storeOpts, { ...options, reportLevel });
  const orders = reportLevel === 'shipment' ? fetched : deduplicateOrders(fetched);
  throwIfCanceled(isCanceled, 'Report job canceled after fetching orders.');

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'preparing-report',
      ordersTotal: orders.length,
      message: orders.length > 0
        ? `Fetched ${orders.length} orders. Preparing line items and shipments.`
        : 'No matching orders found. Preparing an empty report.',
    });
  }

  // Debug details come from the first enriched order in buildReportTables, so no extra billable request is made here.
  const debugInfo = null;

  return {
    orders,
    reportLevel,
    debugInfo,
    storeOpts,
  };
}

module.exports = {
  getRunContext,
  validateRunRequest,
};
