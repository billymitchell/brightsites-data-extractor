const { fetchAllPages, loadOrder } = require('../lib/brightSites');
const { getConfiguredStores } = require('../config/stores');
const { logWarn } = require('../utils/logger');

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

async function fetchOrders(params, statuses, storeOpts) {
  if (statuses.length > 1) {
    const baseParams = Object.assign({}, params);
    const lists = await Promise.all(
      statuses.map((status) => fetchAllPages('/orders', Object.assign({}, baseParams, { status }), 200, storeOpts))
    );
    const dedup = new Map();
    const keyOf = (order) => String(order && (order.order_id || order.id || order.orderNumber || order.number || ''));
    lists.flat().forEach((order) => {
      const key = keyOf(order);
      if (key && !dedup.has(key)) dedup.set(key, order);
    });
    return Array.from(dedup.values());
  }

  if (statuses.length === 1) params.status = statuses[0];
  return fetchAllPages('/orders', params, 200, storeOpts);
}

async function buildDebugInfo(orders, storeOpts) {
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
    const fullFirst = await loadOrder(firstId, storeOpts);
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

async function getRunContext(body = {}) {
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

  const storeOpts = { subdomain: store.subdomain, token: store.token };
  const params = {};
  const dateFilterType = 'created_at';
  params[`${dateFilterType}_from`] = new Date(body.start).toISOString();
  params[`${dateFilterType}_to`] = new Date(body.end).toISOString();

  const statuses = parseStatuses(body.status);
  const orders = await fetchOrders(params, statuses, storeOpts);
  const debugInfo = await buildDebugInfo(orders, storeOpts);

  return {
    orders,
    debugInfo,
    storeOpts,
  };
}

module.exports = {
  getRunContext,
};
