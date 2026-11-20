const { getReportColumnConfig, STRUCTURED_COLUMNS } = require('../config/report');
const { pickFirstValue } = require('../utils/fields');
const { formatDateMDY } = require('../utils/formatters');
const { aggregateShipmentLineItems, buildStructuredContactFields, extractOrderAmounts, buildRowDetails } = require('./reportFields');

function sumQuantities(values) {
  const valid = values.map(value => value == null || String(value).trim() === '' ? NaN : Number(value));
  return valid.every(n => Number.isFinite(n) && n >= 0) ? valid.reduce((a, b) => a + b, 0) : '';
}
function distinctRecords(records, requireId) {
  const unique = new Map();
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') throw new Error('Invalid report source record.');
    const id = pickFirstValue(record, 'id');
    if (id === '' && requireId) throw new Error('Line item is missing an identifier.');
    const key = id === '' ? `position:${index}` : `id:${id}`;
    if (!unique.has(key)) unique.set(key, record);
  });
  return [...unique.values()];
}
function summarizeDetails(items, optionsSettings) {
  const maps = { personalization: new Map(), options: new Map() };
  for (const item of items) {
    const details = buildRowDetails(item, optionsSettings);
    for (const kind of Object.keys(maps)) {
      for (const [key, value] of details[kind]) {
        const values = maps[kind].get(key) || new Set();
        values.add(String(value));
        maps[kind].set(key, values);
      }
    }
  }
  return Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, [...map].map(([key, values]) => [key, [...values].join('; ')])]));
}
function itemSummary(items, valueOf) {
  return [...new Set(items.map(valueOf).filter(value => value !== '' && value != null).map(String))].join('; ');
}
function buildOrderReportEntry({ order, line_items = [], shipments = [] }) {
  const items = distinctRecords(line_items, true);
  const uniqueShipments = distinctRecords(shipments, false);
  const details = summarizeDetails(items);
  const originalOptions = summarizeDetails(items, { splitVersion: false }).options;
  const amounts = extractOrderAmounts(order);
  const payment = order.payment || (Array.isArray(order.payments) ? order.payments[0] : null) || {};
  const dates = uniqueShipments.map(s => s.ship_date || s.shipped_at).filter(v => formatDateMDY(v) && Number.isFinite(Date.parse(v))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const shipmentCost = pickFirstValue(order.shipment, 'cost');
  const shipped = uniqueShipments.flatMap(s => [...aggregateShipmentLineItems(s).values()].map(v => v.hasQty ? v.qtySum : undefined));
  for (const shipment of uniqueShipments) {
    for (const allocation of shipment.line_items || []) {
      if (allocation && typeof allocation === 'object') {
        const quantity = pickFirstValue(allocation, 'quantity', 'qty', 'shipped_quantity', 'units', 'count', 'amount', 'shipped_qty');
        if (sumQuantities([quantity]) === '') shipped.push(undefined);
      }
    }
  }
  const values = {
    'Order #': String(order.order_id ?? order.id ?? ''),
    Placed: formatDateMDY(order.placed_at || order.created_at),
    'Order Status': order.status || '', 'Billing Month': '',
    'Order Total': pickFirstValue(order, 'order_total', 'orderTotal', 'grand_total', 'total'),
    'Order Item Total': pickFirstValue(order, 'item_total'),
    'Order Sales Tax': amounts.salesTax ?? '', 'Order Shipping Sales Tax': amounts.shippingTax ?? '',
    'Order Discounts': amounts.discounts ?? '',
    'Store Shipping Cost': shipmentCost !== '' ? shipmentCost : amounts.shipping ?? pickFirstValue(order, 'shipping_total', 'shipping_cost', 'shipping_amount', 'shipping_price'),
    'Customer Email': pickFirstValue(order, 'customer_email'), Username: pickFirstValue(order, 'username'),
    'Customer ID': pickFirstValue(order, 'customer_id'),
    'Payment Method': pickFirstValue(payment.details, 'method'), 'Payment Status': pickFirstValue(payment, 'state'),
    'In-Hands Date': pickFirstValue(order.shipment, 'in_hands_date') || pickFirstValue(order, 'in_hands_date'),
    'Order Updated': pickFirstValue(order, 'updated_at'),
    'Unique Item Count': items.length, 'Original Quantity': sumQuantities(items.map(i => i.quantity)),
    'Shipped Quantity': sumQuantities(shipped), 'Shipment Count': uniqueShipments.length,
    'Tracking #': [...new Set(uniqueShipments.map(s => s.tracking_number || s.tracking).filter(Boolean).map(String))].join('; '),
    'First Ship Date': formatDateMDY(dates[0]), 'Last Ship Date': formatDateMDY(dates[dates.length - 1]),
    'Product Name': itemSummary(items, i => i.name || i.product_name || ''),
    SKU: itemSummary(items, i => pickFirstValue(i, 'final_sku', 'sku', 'product_sku', 'variant_sku', 'item_sku', 'sku_code', 'skuNumber', 'product_code', 'code')),
    'Product Options': originalOptions.map(([key, value]) => `${key.replace('Product Option: ', '')}: ${value}`).join('; '),
    'Product Personalization': details.personalization.map(([key, value]) => `${key.replace('Product Personalization: ', '')}: ${value}`).join('; '),
  };
  const contacts = buildStructuredContactFields(order);
  for (const column of STRUCTURED_COLUMNS) values[column] = contacts[column[0].toLowerCase() + column.slice(1).replace(/ /g, '')];
  return { row: getReportColumnConfig('order').columns.map(c => values[c] ?? ''), rowDetails: details };
}
module.exports = { buildOrderReportEntry };
