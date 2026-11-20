const { fetchAllPages } = require('../lib/brightSites');
const { deduplicateOrders, tagOrderStore } = require('./reportFields');
const { normalizeReportLevel } = require('../config/report');
const { getConfiguredStores } = require('../config/stores');
const { logWarn } = require('../utils/logger');
const { throwIfCanceled } = require('../utils/cancel');
const { dayStartUtc, dayEndUtc } = require('../utils/timezone');

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

// storeKeys (array or comma list) selects several stores for one consolidated report; storeKey is the single-store form.
function parseStoreKeys(body) {
  let keys = body.storeKeys != null ? body.storeKeys : body.storeKey;
  if (typeof keys === 'string') keys = keys.split(',');
  if (!Array.isArray(keys)) keys = keys == null ? [] : [keys];
  return [...new Set(keys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean))];
}

function validateRunRequest(body = {}) {
  const reportLevel = normalizeReportLevel(body.reportLevel);
  if (reportLevel === 'order' && body.includeUps === true) {
    throw createHttpError(400, 'UPS tracking is available in Shipment Level or Both tables.');
  }
  const stores = getConfiguredStores();
  const storeKeys = parseStoreKeys(body);
  if (!storeKeys.length) {
    throw createHttpError(400, 'Choose at least one store: send storeKeys (or storeKey). Call GET /api/stores to list available stores.');
  }
  const missing = storeKeys.filter((key) => !Object.hasOwn(stores, key));
  if (missing.length) {
    throw createHttpError(400, `Store ${missing.map((k) => `'${k}'`).join(', ')} not found. Available stores: ${Object.keys(stores).join(', ')}`);
  }
  const selectedStores = storeKeys.map((key) => {
    const store = stores[key];
    return {
      storeKey: key,
      label: store.label || store.subdomain || key,
      subdomain: store.subdomain,
      url: store.url || '',
      storeOpts: { subdomain: store.subdomain, token: store.token, storeKey: key },
    };
  });
  const storeKey = storeKeys[0];
  const store = stores[storeKey];

  if (!body.start || !body.end) {
    throw createHttpError(400, 'Both start and end dates are required to prevent returning all data.');
  }

  // Date-only values are whole business days in REPORT_TIMEZONE, not UTC days.
  const parseBoundary = (value, endOfDay) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return new Date(value);
    return endOfDay ? dayEndUtc(value) : dayStartUtc(value);
  };
  const startDate = parseBoundary(body.start, false);
  const endDate = parseBoundary(body.end, true);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createHttpError(400, 'Start and end must be valid dates.');
  }
  if (endDate < startDate) {
    throw createHttpError(400, 'End date must be on or after the start date.');
  }

  const storeOpts = selectedStores[0].storeOpts;
  const params = {};
  const dateFilterType = 'created_at';
  params[`${dateFilterType}_from`] = startDate.toISOString();
  params[`${dateFilterType}_to`] = endDate.toISOString();

  return {
    store,
    reportLevel,
    storeKey,
    storeKeys,
    stores: selectedStores,
    storeOpts,
    params,
    statuses: parseStatuses(body.status),
  };
}

async function getRunContext(body = {}, options = {}) {
  const { params, statuses, storeOpts, reportLevel, stores } = validateRunRequest(body);
  const { onProgress, isCanceled } = options;

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'fetching-orders',
      message: 'Fetching matching orders from BrightSites.',
    });
  }

  throwIfCanceled(isCanceled, 'Report job canceled before fetching orders.');
  // Stores are fetched one after another so progress reads clearly and API load stays per store.
  const fetched = [];
  for (const [index, store] of stores.entries()) {
    const storeProgress = typeof onProgress === 'function' && stores.length > 1
      ? (progress) => onProgress({
        ...progress,
        storesProcessed: index,
        storesTotal: stores.length,
        currentStore: store.label,
        message: `${store.label} (store ${index + 1} of ${stores.length}): ${progress.message || ''}`.trim(),
      })
      : onProgress;
    const orders = await fetchOrders({ ...params }, statuses, store.storeOpts, { ...options, onProgress: storeProgress, reportLevel });
    for (const order of orders) fetched.push(tagOrderStore(order, store));
    throwIfCanceled(isCanceled, 'Report job canceled while fetching orders.');
  }
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
    stores,
  };
}

// Fetches every order for one store created within [startDate, endDate] (Date instants).
async function fetchOrdersInRange({ storeKey, store, startDate, endDate, statuses = [] }, options = {}) {
  const storeOpts = { subdomain: store.subdomain, token: store.token, storeKey };
  const params = { created_at_from: startDate.toISOString(), created_at_to: endDate.toISOString() };
  const orders = await fetchOrders(params, statuses, storeOpts, { ...options, reportLevel: 'order' });
  return { orders: deduplicateOrders(orders), storeOpts };
}

module.exports = {
  fetchOrdersInRange,
  getRunContext,
  validateRunRequest,
};
