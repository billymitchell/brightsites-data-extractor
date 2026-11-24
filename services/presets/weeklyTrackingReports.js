const c = require('./common');
const { zonedDateString } = require('../../utils/timezone');

const TRACKING_COLUMNS = [
  { header: 'Order #', type: 'id', width: 10 },
  { header: 'Order Date', type: 'date', width: 12 },
  { header: 'Ship Date', type: 'date', width: 12 },
  { header: 'Product', width: 34, wrap: true },
  { header: 'Size', width: 24, wrap: true },
  { header: 'Color', width: 14 },
  { header: 'Qty', type: 'integer', width: 7 },
  { header: 'Tracking Number', width: 24 },
];
const PLACED_COLUMNS = [
  { header: 'Order #', type: 'id', width: 10 },
  { header: 'Placed', type: 'date', width: 12 },
  { header: 'Product Name', width: 34, wrap: true },
  { header: 'Quantity', type: 'integer', width: 10 },
];
const ESTABLISHMENT = { header: 'Personalized Establishment Name', width: 36, wrap: true };

const byOrderDesc = (a, b) => c.compareOrdersDesc({ order: { order_id: a[0] } }, { order: { order_id: b[0] } });
const establishment = li => c.personalizationValue(li, 'Personalized Establishment Name', 'Establishment Name');

// Line items of live orders placed in the range.
function placedItems(store, range) {
  const out = [];
  for (const { order, line_items: items } of store ? store.orders : []) {
    if (c.isCanceled(order) || !c.inRange(c.placedDate(order), range)) continue;
    for (const li of items) out.push({ order, li });
  }
  return out;
}

// One row per line item in each shipment whose ship date falls in the range.
function trackingRows(store, range) {
  const rows = [];
  for (const { order, line_items: items, shipments } of store ? store.orders : []) {
    if (c.isCanceled(order)) continue;
    const itemsById = new Map(items.map(li => [String(li.id), li]));
    for (const shipment of shipments || []) {
      const shipped = zonedDateString(shipment.ship_date || shipment.created_at);
      if (!c.inRange(shipped, range)) continue;
      const allocations = Array.isArray(shipment.line_items) && shipment.line_items.length
        ? shipment.line_items
        : (shipment.line_item_ids || []).map(id => ({ id, quantity: null }));
      for (const alloc of allocations) {
        const li = itemsById.get(String(alloc.id)) || {};
        rows.push([
          c.orderNumber(order), c.placedDate(order), shipped,
          c.text(li.name || li.product_name),
          c.optionValue(li, 'Size'),
          c.optionValue(li, 'Color', 'Colour'),
          c.quantity(alloc.quantity ?? li.quantity),
          c.text(shipment.tracking_number),
        ]);
      }
    }
  }
  return rows.sort((a, b) => byOrderDesc(a, b) || String(b[2]).localeCompare(String(a[2])));
}

function build({ stores, ranges }) {
  const ytd = ranges.ytd;
  const awards = placedItems(stores.redemption, ytd).map(({ order, li }) => [
    c.orderNumber(order), c.placedDate(order), c.text(li.name || li.product_name), c.quantity(li.quantity),
    c.awardInfo(li).type, c.personalizationValue(li, 'Redemption Code'), establishment(li),
  ]).sort(byOrderDesc);
  const productPlaced = placedItems(stores.product, ytd).map(({ order, li }) => [
    c.orderNumber(order), c.placedDate(order), c.text(li.name || li.product_name), c.quantity(li.quantity),
  ]).sort(byOrderDesc);
  const vlrPlaced = placedItems(stores.vlr, ytd).map(({ order, li }) => [
    c.orderNumber(order), c.placedDate(order), c.text(li.name || li.product_name), c.quantity(li.quantity), establishment(li) || 'n/a',
  ]).sort(byOrderDesc);

  const table = (name, columns, rows) => ({ name, kind: 'table', columns, rows, freezeColumns: 1 });
  const sheets = [
    table('Awards Redeemed YTD', PLACED_COLUMNS.concat([
      { header: 'Award Type', width: 12 }, { header: 'Redemption Code', width: 18 }, ESTABLISHMENT,
    ]), awards),
    table('Redemption Store Tracking', TRACKING_COLUMNS, trackingRows(stores.redemption, ytd)),
    table('Product Store Orders Placed', PLACED_COLUMNS, productPlaced),
    table('Product Store Tracking', TRACKING_COLUMNS, trackingRows(stores.product, ytd)),
    table('VLR Store Orders Placed', PLACED_COLUMNS.concat([ESTABLISHMENT]), vlrPlaced),
    table('VLR Store Tracking', TRACKING_COLUMNS, trackingRows(stores.vlr, ytd)),
  ];
  return {
    sheets,
    summary: Object.fromEntries(sheets.map(s => [s.name, s.rows.length])),
    warnings: [],
  };
}

module.exports = {
  id: 'weekly-ftg-tracking-reports',
  program: 'ftg',
  title: 'Weekly FTG Tracking Reports',
  description: 'Year-to-date awards redeemed, orders placed and shipment tracking for the Redemption, Product and VLR stores.',
  rangeHelp: 'Runs from January 1 of the end date\'s year to the end date (the start date is not used). Tracking sheets list shipments sent in that period, including orders placed late last year.',
  stores: {
    redemption: { required: true, fetch: 'tracking' },
    product: { required: true, fetch: 'tracking' },
    vlr: { required: false, fetch: 'tracking' },
  },
  build,
};
