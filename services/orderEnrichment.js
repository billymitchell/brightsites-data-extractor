const sites = require('../lib/brightSites');
const orderCache = require('./orderCache');
const { orderLookupId } = require('./reportFields');

// Loads one order with its line items and shipments.
// BrightSites embeds line_items and shipments in GET /orders/:id, so one request is
// normally enough; the separate endpoints are only used when an embedded list is missing.
async function loadEnrichedOrder(order, storeOpts = {}, { isCanceled } = {}) {
  const id = orderLookupId(order);
  const scope = storeOpts.subdomain || storeOpts.storeKey || 'default';
  const updatedAt = order.updated_at;
  // Cache only the API's own response and merge it exactly as an uncached load would.
  const cached = orderCache.get(scope, id, updatedAt);
  if (cached) return { order: Object.assign({}, order, cached.full), line_items: cached.line_items, shipments: cached.shipments };

  const opts = Object.assign({}, storeOpts, { isCanceled, failOnError: true });
  const full = (await sites.loadOrder(id, opts)) || {};
  const [lineItems, shipments] = await Promise.all([
    Array.isArray(full.line_items) ? full.line_items : sites.loadLineItems(id, opts),
    Array.isArray(full.shipments) ? full.shipments : sites.loadShipments(id, opts),
  ]);
  const cachedValue = { full, line_items: lineItems || [], shipments: shipments || [] };
  orderCache.set(scope, id, updatedAt, cachedValue);
  return { order: Object.assign({}, order, full), line_items: cachedValue.line_items, shipments: cachedValue.shipments };
}

module.exports = { loadEnrichedOrder };
