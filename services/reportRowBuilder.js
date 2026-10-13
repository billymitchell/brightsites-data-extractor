const { getReportColumnConfig, normalizeReportLevel } = require('../config/report');
const { buildOrderReportEntry } = require('./orderRowBuilder');
const { loadOrder, loadLineItems, loadShipments } = require('../lib/brightSites');
const { promisePool } = require('../utils/async');
const {
  formatDateMDY,
  formatProductOptions,
  formatProductPersonalization,
} = require('../utils/formatters');
const { pickFirstValue } = require('../utils/fields');
const { logWarn } = require('../utils/logger');
const { throwIfCanceled } = require('../utils/cancel');

const { aggregateShipmentLineItems, buildStructuredContactFields, extractOrderAmounts, buildRowDetails, toMoney, makeOrderKey, deduplicateOrders, orderLookupId } = require('./reportFields');

function buildRow({ order, placed, lineItemId, lineItem, tracking, shippingLanded, shipMethod, shipDate, shippedQty }) {
  const structured = buildStructuredContactFields(order);
  const productPersonalization = formatProductPersonalization(
    lineItem.product_personalizations || lineItem.personalizations || lineItem.personalization || lineItem.product_personalization
  );
  const originalQty = lineItem.quantity || '';
  const productName = lineItem.name || lineItem.product_name || '';
  const productOptions = formatProductOptions(lineItem.options_text || lineItem.product_options || lineItem.options);
  const sku = pickFirstValue(
    lineItem,
    'final_sku',
    'sku',
    'product_sku',
    'variant_sku',
    'item_sku',
    'sku_code',
    'skuNumber',
    'product_code',
    'code'
  );
  const unitPrice = pickFirstValue(lineItem, 'unit_price', 'unitPrice', 'price', 'price_each');
  const totalPrice = pickFirstValue(lineItem, 'total_price', 'totalPrice', 'line_total', 'extended_price');
  const taxTotal = pickFirstValue(lineItem, 'tax_price', 'tax_total', 'taxTotal', 'tax_amount', 'tax');
  const amounts = extractOrderAmounts(order);
  const payment = order.payment || (Array.isArray(order.payments) ? order.payments[0] : null) || {};
  const logoCharges = Array.isArray(lineItem.logos)
    ? lineItem.logos.reduce((sum, l) => sum + toMoney(l && l.charge), 0).toFixed(2)
    : '';
  const orderTotal = pickFirstValue(order, 'order_total', 'orderTotal', 'grand_total', 'total');
  const storeShippingCost = pickFirstValue(order.shipment || {}, 'cost')
    || amounts.shipping
    || pickFirstValue(order, 'shipping_total', 'shipping_cost', 'shipping_amount', 'shipping_price');
  const val = (v) => (v == null ? '' : String(v));

  return [
    String(order.order_id || order.id || ''),
    placed,
    order.status || '',
    String(lineItem.id || lineItemId || ''),
    tracking,
    shippingLanded,
    shipMethod,
    shipDate,
    productPersonalization,
    String(originalQty),
    String(shippedQty),
    productName,
    sku,
    productOptions,
    '',
    unitPrice,
    totalPrice,
    taxTotal,
    orderTotal,
    storeShippingCost,
    structured.billingName,
    structured.billingCompany,
    structured.billingAddress1,
    structured.billingAddress2,
    structured.billingCity,
    structured.billingState,
    structured.billingZip,
    structured.billingCountry,
    structured.billingEmail,
    structured.billingPhone,
    structured.shippingName,
    structured.shippingCompany,
    structured.shippingAddress1,
    structured.shippingAddress2,
    structured.shippingCity,
    structured.shippingState,
    structured.shippingZip,
    structured.shippingCountry,
    structured.shippingEmail,
    structured.shippingPhone,
    pickFirstValue(order, 'item_total'),
    val(amounts.salesTax),
    val(amounts.shippingTax),
    val(amounts.discounts),
    pickFirstValue(order, 'customer_email'),
    pickFirstValue(order, 'username'),
    pickFirstValue(order, 'customer_id'),
    pickFirstValue(payment.details || {}, 'method'),
    pickFirstValue(payment, 'state'),
    pickFirstValue(order.shipment || {}, 'in_hands_date') || pickFirstValue(order, 'in_hands_date'),
    pickFirstValue(order, 'updated_at'),
    pickFirstValue(lineItem, 'product_id'),
    pickFirstValue(lineItem, 'final_internal_id'),
    pickFirstValue(lineItem, 'tax_code'),
    pickFirstValue(lineItem, 'product_price'),
    pickFirstValue(lineItem, 'options_price'),
    logoCharges,
    pickFirstValue(lineItem, 'note'),
  ];
}

async function buildReportTables({ orders, storeOpts, debugInfo, onProgress, isCanceled, maxRows = Infinity, reportLevel = 'shipment' }) {
  normalizeReportLevel(reportLevel);
  if (reportLevel !== 'shipment') orders = deduplicateOrders(orders);
  const orderRows = [], orderDetails = [], orderKeys = [], rowKeys = [];
  let currentOrderKey;
  const checkLimit = () => {
    if (orderRows.length + rows.length >= maxRows) throw new Error(`Report exceeds the maximum of ${maxRows} rows. Narrow the date range and try again.`);
  };
  let currentDebugInfo = debugInfo;
  const rows = [];
  const rowDetails = [];
  let ordersProcessed = 0;
  const appendRow = (row, lineItem) => {
    checkLimit();
    rows.push(row);
    rowKeys.push(currentOrderKey);
    rowDetails.push(buildRowDetails(lineItem));
  };

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'enriching-orders',
      ordersProcessed: 0,
      ordersTotal: orders.length,
      message: orders.length > 0
        ? `Loading full order details for ${orders.length} orders.`
        : 'No orders matched the request.',
    });
  }

  const enriched = await promisePool(
    orders,
    async (order) => {
      throwIfCanceled(isCanceled, 'Report job canceled while enriching orders.');
      const orderIdentifier = orderLookupId(order);
      const [fullOrder, lineItems, shipments] = await Promise.all([
        loadOrder(orderIdentifier, Object.assign({}, storeOpts, { isCanceled, failOnError: reportLevel !== 'shipment' })),
        loadLineItems(orderIdentifier, Object.assign({}, storeOpts, { isCanceled, failOnError: reportLevel !== 'shipment' })),
        loadShipments(orderIdentifier, Object.assign({}, storeOpts, { isCanceled, failOnError: reportLevel !== 'shipment' })),
      ]);
      const mergedOrder = Object.assign({}, order, fullOrder || {});
      ordersProcessed += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'enriching-orders',
          ordersProcessed,
          ordersTotal: orders.length,
          message: `Loaded order details for ${ordersProcessed} of ${orders.length} orders.`,
        });
      }
      return { order: mergedOrder, line_items: lineItems, shipments };
    },
    5,
    { stopOnError: true }
  );

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'building-rows',
      ordersProcessed: 0,
      ordersTotal: enriched.length,
      message: enriched.length > 0
        ? `Building report rows from ${enriched.length} enriched orders.`
        : 'Building report rows.',
    });
  }

  let rowsBuiltFromOrders = 0;

  enriched.forEach((entry) => {
    throwIfCanceled(isCanceled, 'Report job canceled while building rows.');
    if (entry && entry.error) {
      logWarn('services/reportRowBuilder.buildReportRows', 'Order enrichment failed inside promise pool', {
        error: entry.error,
      });
      throw new Error(entry.error);
    }
    const { order, line_items = [], shipments = [] } = entry;
    currentOrderKey = makeOrderKey(storeOpts.subdomain, order);
    if (reportLevel !== 'shipment') {
      checkLimit();
      const summary = buildOrderReportEntry(entry);
      orderRows.push(summary.row);
      orderDetails.push(summary.rowDetails);
      orderKeys.push(currentOrderKey);
    }
    if (reportLevel !== 'order') {
    const placed = formatDateMDY(order.placed_at || order.created_at);
    const liMap = new Map();
    line_items.forEach((li) => {
      if (li && li.id != null) liMap.set(String(li.id), li);
    });

    const processedLineItems = new Set();

    shipments.forEach((shipment) => {
      const agg = aggregateShipmentLineItems(shipment);
      if (agg.size === 0) return;

      const shippingLanded = (shipment.landed_cost || shipment.shipping_cost || '') || order.shipping_total || '';
      const shipMethod = (shipment.shipping_method || order.shipping_method) || '';
      const shipDate = formatDateMDY(shipment.ship_date || shipment.shipped_at);
      const tracking = (shipment.tracking_number || shipment.tracking || '') || '';

      agg.forEach((info, liId) => {
        processedLineItems.add(liId);
        const lineItem = liMap.get(String(liId)) || { id: liId };

        if (!currentDebugInfo) {
          const billingSrc = order.billing_contact || order.billing_address || order.billing || {};
          const shippingSrc = order.shipping_contact || order.shipping_address || order.shipping || {};
          currentDebugInfo = {
            order_id: order.order_id || order.id || null,
            billingSrc,
            shippingSrc,
            representative: shipment || null,
            order_sample: {
              customer: order.customer || null,
              customer_email: order.customer_email || null,
              billing: order.billing || null,
              billing_address: order.billing_address || null,
              shipping: order.shipping || null,
              shipping_address: order.shipping_address || null,
            },
          };
        }

        appendRow(buildRow({
          order,
          placed,
          lineItemId: liId,
          lineItem,
          tracking,
          shippingLanded,
          shipMethod,
          shipDate,
          shippedQty: info.hasQty ? String(info.qtySum) : '',
        }), lineItem);
      });
    });

    line_items.forEach((lineItem) => {
      if (!lineItem || lineItem.id == null) return;
      const liId = String(lineItem.id);
      if (processedLineItems.has(liId)) return;

      appendRow(buildRow({
        order,
        placed,
        lineItemId: liId,
        lineItem,
        tracking: '',
        shippingLanded: '',
        shipMethod: '',
        shipDate: '',
        shippedQty: '',
      }), lineItem);
    });

    }

    rowsBuiltFromOrders += 1;
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'building-rows',
        ordersProcessed: rowsBuiltFromOrders,
        ordersTotal: enriched.length,
        rowsBuilt: rows.length + orderRows.length,
        message: `Built rows for ${rowsBuiltFromOrders} of ${enriched.length} orders.`,
      });
    }
  });

  const tables = {};
  if (reportLevel !== 'shipment') tables.order = { columns: getReportColumnConfig('order').columns, rows: orderRows, rowDetails: orderDetails, rowKeys: orderKeys };
  if (reportLevel !== 'order') tables.shipment = { columns: getReportColumnConfig('shipment').columns, rows, rowDetails, rowKeys };
  if (!currentDebugInfo && enriched.length) currentDebugInfo = { order_id: enriched[0].order.order_id || enriched[0].order.id };
  return { tables, debugInfo: currentDebugInfo };
}
async function buildReportRows(options) {
  const level = options.reportLevel || 'shipment';
  getReportColumnConfig(level);
  const result = await buildReportTables({ ...options, reportLevel: level });
  return { ...result.tables[level], debugInfo: result.debugInfo };
}

module.exports = { buildReportRows, buildReportTables, extractOrderAmounts };
