const { pickFirstValue } = require('../utils/fields');
const { extractOptionPairs, extractPersonalizationPairs } = require('../utils/formatters');

function aggregateShipmentLineItems(shipment) {
  const rawObjEntries = (shipment.line_items || []).map((x) => (typeof x === 'object' ? x : { id: x }));
  const rawIdEntries = (shipment.line_item_ids || []).map((x) => ({ id: x }));
  const combined = rawObjEntries.concat(rawIdEntries);
  const agg = new Map();

  combined.forEach((entry) => {
    const liId = String(entry.id || entry.line_item_id || entry.item_id || '');
    if (!liId) return;
    const rawQty = pickFirstValue(entry, 'quantity', 'qty', 'shipped_quantity', 'units', 'count', 'amount', 'shipped_qty');
    const qtyNum = rawQty === '' ? null : Number(rawQty);
    const prev = agg.get(liId) || { qtySum: 0, hasQty: false, sample: entry };
    if (qtyNum != null && !Number.isNaN(qtyNum)) {
      prev.qtySum += qtyNum;
      prev.hasQty = true;
    }
    prev.sample = prev.sample || entry;
    agg.set(liId, prev);
  });

  return agg;
}

function buildStructuredContactFields(order) {
  const billingMerged = Object.assign({}, order.billing || {}, order.billing_address || {}, order.billing_contact || {});
  const shippingMerged = Object.assign({}, order.shipping || {}, order.shipping_address || {}, order.shipping_contact || {});

  const billingFirst = pickFirstValue(billingMerged, 'first_name', 'first', 'firstName', 'firstname');
  const billingLast = pickFirstValue(billingMerged, 'last_name', 'last', 'lastName', 'lastname');
  const shippingFirst = pickFirstValue(shippingMerged, 'first_name', 'first', 'firstName', 'firstname');
  const shippingLast = pickFirstValue(shippingMerged, 'last_name', 'last', 'lastName', 'lastname');
  const customerFallback = pickFirstValue(order, 'customer_name', 'customer', 'username');

  return {
    billingName: (billingFirst || billingLast) ? `${billingFirst || ''} ${billingLast || ''}`.trim() : (customerFallback || ''),
    billingCompany: pickFirstValue(billingMerged, 'company', 'business', 'org'),
    billingAddress1: pickFirstValue(billingMerged, 'first_address', 'address1', 'firstAddress', 'address', 'street1'),
    billingAddress2: pickFirstValue(billingMerged, 'second_address', 'address2', 'secondAddress', 'address_line_2', 'street2'),
    billingCity: pickFirstValue(billingMerged, 'city', 'town'),
    billingState: pickFirstValue(billingMerged, 'state', 'province', 'region'),
    billingZip: pickFirstValue(billingMerged, 'zip', 'postcode', 'postal_code'),
    billingCountry: pickFirstValue(billingMerged, 'country', 'country_name'),
    billingEmail: pickFirstValue(billingMerged, 'email', 'contact_email') || pickFirstValue(order, 'customer_email', 'customer'),
    billingPhone: pickFirstValue(billingMerged, 'phone', 'telephone', 'contact_phone') || pickFirstValue(order, 'customer_phone'),
    shippingName: (shippingFirst || shippingLast) ? `${shippingFirst || ''} ${shippingLast || ''}`.trim() : (customerFallback || ''),
    shippingCompany: pickFirstValue(shippingMerged, 'company', 'business', 'org'),
    shippingAddress1: pickFirstValue(shippingMerged, 'first_address', 'address1', 'firstAddress', 'address', 'street1'),
    shippingAddress2: pickFirstValue(shippingMerged, 'second_address', 'address2', 'secondAddress', 'address_line_2', 'street2'),
    shippingCity: pickFirstValue(shippingMerged, 'city', 'town'),
    shippingState: pickFirstValue(shippingMerged, 'state', 'province', 'region'),
    shippingZip: pickFirstValue(shippingMerged, 'zip', 'postcode', 'postal_code'),
    shippingCountry: pickFirstValue(shippingMerged, 'country', 'country_name'),
    shippingEmail: pickFirstValue(shippingMerged, 'email', 'contact_email') || pickFirstValue(order, 'customer_email', 'customer'),
    shippingPhone: pickFirstValue(shippingMerged, 'phone', 'telephone', 'contact_phone') || pickFirstValue(order, 'customer_phone'),
  };
}

function toMoney(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function sumAdjustments(list, predicate) {
  if (!Array.isArray(list)) return null;
  const hits = list.filter((a) => a && predicate(String(a.note || '').toLowerCase()));
  if (!hits.length) return null;
  return hits.reduce((sum, a) => sum + toMoney(a.amount), 0).toFixed(2);
}

function extractOrderAmounts(order) {
  const required = order.required_adjustments;
  const discounts = ['coupons_adjustments', 'custom_adjustments', 'balance_adjustments']
    .reduce((acc, key) => {
      const list = Array.isArray(order[key]) ? order[key] : [];
      return list.length ? (acc || 0) + list.reduce((sum, a) => sum + toMoney(a && a.amount), 0) : acc;
    }, null);
  return {
    salesTax: sumAdjustments(required, (n) => n.includes('sales tax') && !n.includes('shipping')),
    shippingTax: sumAdjustments(required, (n) => n.includes('shipping') && n.includes('tax')),
    shipping: sumAdjustments(required, (n) => n === 'shipment' || n === 'shipping'),
    discounts: discounts == null ? null : discounts.toFixed(2),
  };
}

function buildRowDetails(lineItem) {
  // Named options preserve the keys needed to build columns; summary text may not.
  let options = [];
  for (const source of [lineItem.product_options, lineItem.options, lineItem.options_text]) {
    options = extractOptionPairs(source);
    if (options.length) break;
  }
  return {
    personalization: extractPersonalizationPairs(
      lineItem.product_personalizations || lineItem.personalizations || lineItem.personalization || lineItem.product_personalization
    ),
    options,
  };
}

function orderLookupId(order) {
  const id = pickFirstValue(order, 'id', 'order_id', 'orderNumber', 'number');
  if (id === '') throw new Error('Order is missing an API lookup identifier.');
  return String(id);
}
function makeOrderKey(storeSubdomain, order) {
  return encodeURIComponent(storeSubdomain || 'default') + ':' + encodeURIComponent(orderLookupId(order)).replace(/\*/g, '%2A');
}
function deduplicateOrders(orders) {
  const unique = new Map();
  for (const order of orders) {
    const id = orderLookupId(order);
    if (!unique.has(id)) unique.set(id, order);
  }
  return [...unique.values()];
}
module.exports = { aggregateShipmentLineItems, buildStructuredContactFields, extractOrderAmounts,
  buildRowDetails, toMoney, orderLookupId, makeOrderKey, deduplicateOrders };
