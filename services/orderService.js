const { fetchAllPages, loadOrder } = require('../lib/brightSites');
const { getConfiguredStores } = require('../config/stores');
const { logWarn } = require('../utils/logger');
const { isCanceledError, throwIfCanceled } = require('../utils/cancel');

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

  const startDate = new Date(body.start);
  const endDate = new Date(body.end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createHttpError(400, 'Start and end must be valid dates.');
  }

  const storeOpts = { subdomain: store.subdomain, token: store.token };
  const params = {};
  const dateFilterType = 'created_at';
  params[`${dateFilterType}_from`] = startDate.toISOString();
  params[`${dateFilterType}_to`] = endDate.toISOString();

  return {
    store,
    storeKey,
    storeOpts,
    params,
    statuses: parseStatuses(body.status),
  };
}

async function buildDebugInfo(orders, storeOpts, options = {}) {
  const { isCanceled } = options;
  if (!Array.isArray(orders) || orders.length === 0) return null;

  const order = orders[0] || {};
  let debugInfo = {
    sampleOrderKeys: Object.keys(order),
    sampleOrderFields: {
      order_id: order.order_id || order.id || null,
      customer: order.customer || null,
      customer_email: order.customer_email || null,
      billing: order.billing || null,
      billing_address: order.billing_address || null,
      billing_contact: order.billing_contact || null,
      shipping: order.shipping || null,
      shipping_address: order.shipping_address || null,
      shipping_contact: order.shipping_contact || null,
    },
  };

  const firstId = order.order_id || order.id || order.orderNumber || order.number;
  try {
    throwIfCanceled(isCanceled, 'Report job canceled while loading the debug sample order.');
    const fullFirst = await loadOrder(firstId, Object.assign({}, storeOpts, { isCanceled }));
    debugInfo = {
      sampleOrderKeys: Object.keys(fullFirst || order),
      sampleOrderFields: {
        order_id: fullFirst.order_id || fullFirst.id || order.order_id || order.id || null,
        customer: fullFirst.customer || fullFirst.customer_email || fullFirst.customer_id || order.customer || null,
        customer_email: fullFirst.customer_email || null,
        billing: fullFirst.billing || fullFirst.billing_address || fullFirst.billing_contact || null,
        billing_address: fullFirst.billing_address || null,
        billing_contact: fullFirst.billing_contact || null,
        shipping: fullFirst.shipping || fullFirst.shipment || null,
        shipping_address: fullFirst.shipping_address || null,
        shipping_contact: fullFirst.shipping_contact || null,
      },
    };
  } catch (e) {
    if (isCanceledError(e)) throw e;
    logWarn('services/orderService.buildDebugInfo', 'Falling back to partial order debug info', {
      orderId: firstId,
      error: e.message,
    });
    debugInfo = {
      sampleOrderKeys: Object.keys(order),
      sampleOrderFields: {
        order_id: order.order_id || order.id || null,
        customer: order.customer || null,
        customer_email: order.customer_email || null,
        billing: order.billing || null,
        billing_address: order.billing_address || null,
        billing_contact: order.billing_contact || null,
        shipping: order.shipping || null,
        shipping_address: order.shipping_address || null,
        shipping_contact: order.shipping_contact || null,
      },
    };
  }

  return debugInfo;
}

async function getRunContext(body = {}, options = {}) {
  const { params, statuses, storeOpts } = validateRunRequest(body);
  const { onProgress, isCanceled } = options;

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'fetching-orders',
      message: 'Fetching matching orders from BrightSites.',
    });
  }

  throwIfCanceled(isCanceled, 'Report job canceled before fetching orders.');
  const orders = await fetchOrders(params, statuses, storeOpts, options);
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

  const debugInfo = await buildDebugInfo(orders, storeOpts, { isCanceled });

  return {
    orders,
    debugInfo,
    storeOpts,
  };
}

module.exports = {
  getRunContext,
  validateRunRequest,
};
