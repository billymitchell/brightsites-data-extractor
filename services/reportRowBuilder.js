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

async function buildReportRows({ orders, storeOpts, debugInfo, onProgress, isCanceled, maxRows = Infinity }) {
  let currentDebugInfo = debugInfo;
  const rows = [];
  let ordersProcessed = 0;
  const appendRow = (row) => {
    if (rows.length >= maxRows) {
      throw new Error(`Report exceeds the maximum of ${maxRows} rows. Narrow the date range and try again.`);
    }
    rows.push(row);
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
      const orderIdentifier = order.id || order.order_id || order.orderNumber || order.number;
      const [fullOrder, lineItems, shipments] = await Promise.all([
        loadOrder(orderIdentifier, Object.assign({}, storeOpts, { isCanceled })),
        loadLineItems(orderIdentifier, Object.assign({}, storeOpts, { isCanceled })),
        loadShipments(orderIdentifier, Object.assign({}, storeOpts, { isCanceled })),
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
        }));
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
      }));
    });

    rowsBuiltFromOrders += 1;
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'building-rows',
        ordersProcessed: rowsBuiltFromOrders,
        ordersTotal: enriched.length,
        rowsBuilt: rows.length,
        message: `Built rows for ${rowsBuiltFromOrders} of ${enriched.length} orders.`,
      });
    }
  });

  return {
    rows,
    debugInfo: currentDebugInfo,
  };
}

module.exports = {
  buildReportRows,
  extractOrderAmounts,
};
