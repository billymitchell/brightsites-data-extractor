const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const {
  fetchAllPages,
  loadLineItems,
  loadShipments,
  composeAddressBlob,
  trackingForLineItem,
} = require('./lib/brightSites');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const usage = require('./lib/usage');
const FREE_LIMIT = 30000; // per store per month free calls
const RESERVE = 10000; // keep in reserve (avoid consuming these unless needed)
const OVERAGE_RATE = 0.03; // cost per call beyond free tier

// simple promise pool for concurrency-limited enrichment
async function promisePool(items, worker, concurrency = 5) {
  const results = [];
  let i = 0;
  const runners = new Array(concurrency).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = { error: String(err) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

const COLUMNS = [
  'Order #','Placed','Order Status','Line Item ID','Tracking #',
  'Shipping Landded Cost','Ship Method','Ship Date',
  'Product Personalization','Original Quantity','Shipped Quantity','Product Name','SKU','Product Options',
  'Billing Month'
];

// appended structured columns (kept after the required headers)
const STRUCTURED_COLUMNS = [
  'Billing Name','Billing Company','Billing Address1','Billing Address2','Billing City','Billing State','Billing Zip','Billing Country','Billing Email','Billing Phone',
  'Shipping Name','Shipping Company','Shipping Address1','Shipping Address2','Shipping City','Shipping State','Shipping Zip','Shipping Country','Shipping Email','Shipping Phone'
];

// full columns exposed in API
const ALL_COLUMNS = COLUMNS.concat(STRUCTURED_COLUMNS);

// Format a date-like value to MM/DD/YYYY (no time). Returns '' if invalid/empty.
function formatDateMDY(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return '';
  }
}

function formatProductOptions(opts) {
  if (!opts) return '';
  if (typeof opts === 'string') return opts;
  if (Array.isArray(opts)) {
    return opts.map(o => {
      if (o == null) return '';
      if (typeof o === 'string') return o;
      // common shape: { option_name, sub_option_name }
      if (o.option_name || o.sub_option_name) {
        const name = o.option_name || o.name || '';
        const sub = o.sub_option_name || o.value || o.sub || '';
        return [name, sub].filter(Boolean).join(': ');
      }
      // fallback: stringify shallow
      try { return JSON.stringify(o); } catch (e) { return String(o); }
    }).filter(Boolean).join('; ');
  }
  if (typeof opts === 'object') {
    // map key: value
    try {
      const parts = Object.entries(opts).map(([k, v]) => `${k}: ${v}`);
      return parts.join('; ');
    } catch (e) {
      return String(opts);
    }
  }
  return String(opts);
}

function formatProductPersonalization(pp) {
  if (!pp) return '';
  if (typeof pp === 'string') return pp;
  const arr = Array.isArray(pp) ? pp : (pp.personalizations || pp.product_personalizations || []);
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.map(item => {
    if (!item) return '';
    const title = item.title || item.name || '';
    let attrs = '';
    if (Array.isArray(item.attributes)) {
      attrs = item.attributes.map(a => {
        if (typeof a === 'string') return a;
        const k = a.key || a.name || '';
        const v = a.value || a.val || '';
        return [k, v].filter(Boolean).join(': ');
      }).filter(Boolean).join(', ');
    }
    let price = '';
    if (item.price_modifier) {
      const pt = item.price_modifier.modifier_type || item.price_modifier.type || '';
      const amt = item.price_modifier.amount || item.price_modifier.value || '';
      price = (pt || amt) ? `${pt || ''}${amt || ''}` : '';
    }
    const parts = [];
    if (title) parts.push(title);
    if (attrs) parts.push(`Attributes: ${attrs}`);
    if (price) parts.push(`Price: ${price}`);
    return parts.join(' | ');
  }).filter(Boolean).join(' ; ');
}

// support multiple stores via env var BRIGHTSITES_STORES as JSON object { key: { subdomain, token, label } }
function getConfiguredStores() {
  const env = process.env.BRIGHTSITES_STORES;
  if (env) {
    try {
      const parsed = JSON.parse(env);
      // normalize: if an entry lacks `token`, use the map key as the token
      const out = {};
      Object.entries(parsed).forEach(([k, v]) => {
        const store = Object.assign({}, v || {});
        if (!store.token) store.token = k;
        out[k] = store;
      });
      return out;
    } catch (e) { console.warn('BRIGHTSITES_STORES invalid JSON'); }
  }
  // No hard-coded defaults. Return empty object if BRIGHTSITES_STORES not provided.
  return {};
}

app.post('/api/run', async (req, res) => {
  try {
    const body = req.body || {};
    // require explicit storeKey to avoid accidental defaults; caller must select a store
    const storeKey = body.storeKey;
    const stores = getConfiguredStores();
    if (!storeKey) {
      return res.status(400).json({ error: 'storeKey is required. Call GET /api/stores to list available stores and include storeKey in the request body.' });
    }
    const store = stores[storeKey];
    if (!store) {
      return res.status(400).json({ error: `storeKey '${String(storeKey)}' not found. Available stores: ${Object.keys(stores).join(', ')}` });
    }
    const storeOpts = { subdomain: store.subdomain, token: store.token };
    // Always use created_at for date filtering
    const dateFilterType = 'created_at';
  const status = body.status;

  const params = {};

    // date range (REQUIRED)
    if (!body.start || !body.end) {
      return res.status(400).json({ error: 'Both start and end dates are required to prevent returning all data.' });
    }
    const fromKey = `${dateFilterType}_from`;
    const toKey = `${dateFilterType}_to`;
    params[fromKey] = new Date(body.start).toISOString();
    params[toKey] = new Date(body.end).toISOString();

    // Helper to safely build list of statuses (supports comma-separated string or array)
    const parseStatuses = (s) => {
      if (!s) return [];
      if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
      if (typeof s === 'string') return s.split(',').map(x => x.trim()).filter(Boolean);
      return [];
    };

    // fetch all orders with pagination (support multi-status by merging results)
    let orders = [];
    const statuses = parseStatuses(status);
    if (statuses.length > 1) {
      const baseParams = Object.assign({}, params);
      const lists = await Promise.all(statuses.map(st => fetchAllPages('/orders', Object.assign({}, baseParams, { status: st }), 200, storeOpts)));
      const dedup = new Map();
      const keyOf = (o) => String(o && (o.order_id || o.id || o.orderNumber || o.number || ''));
      lists.flat().forEach(o => { const k = keyOf(o); if (k && !dedup.has(k)) dedup.set(k, o); });
      orders = Array.from(dedup.values());
    } else {
      if (statuses.length === 1) params.status = statuses[0];
      orders = await fetchAllPages('/orders', params, 200, storeOpts);
    }

    // compact snapshot of first order for debugging address fields (safe to JSON)
    let debugInfo = null;
    if (Array.isArray(orders) && orders.length > 0) {
      const o = orders[0] || {};
      debugInfo = {
        sampleOrderKeys: Object.keys(o),
        sampleOrderFields: {
          order_id: o.order_id || o.id || null,
          customer: o.customer || null,
          customer_email: o.customer_email || null,
          billing: o.billing || null,
          billing_address: o.billing_address || null,
          billing_contact: o.billing_contact || null,
          shipping: o.shipping || null,
          shipping_address: o.shipping_address || null,
          shipping_contact: o.shipping_contact || null,
        }
      };
         // try to fetch the show-order for better debug info
         const firstId = o.order_id || o.id || o.orderNumber || o.number;
         try {
           const fullFirst = await require('./lib/brightSites').loadOrder(firstId, storeOpts);
           debugInfo = {
             sampleOrderKeys: Object.keys(fullFirst || o),
             sampleOrderFields: {
               order_id: fullFirst.order_id || fullFirst.id || o.order_id || o.id || null,
               customer: fullFirst.customer || fullFirst.customer_email || fullFirst.customer_id || o.customer || null,
               customer_email: fullFirst.customer_email || null,
               billing: fullFirst.billing || fullFirst.billing_address || fullFirst.billing_contact || null,
               billing_address: fullFirst.billing_address || null,
               billing_contact: fullFirst.billing_contact || null,
               shipping: fullFirst.shipping || fullFirst.shipment || null,
               shipping_address: fullFirst.shipping_address || null,
               shipping_contact: fullFirst.shipping_contact || null,
             }
           };
         } catch (e) {
           const o = orders[0] || {};
           debugInfo = {
             sampleOrderKeys: Object.keys(o),
             sampleOrderFields: {
               order_id: o.order_id || o.id || null,
               customer: o.customer || null,
               customer_email: o.customer_email || null,
               billing: o.billing || null,
               billing_address: o.billing_address || null,
               billing_contact: o.billing_contact || null,
               shipping: o.shipping || null,
               shipping_address: o.shipping_address || null,
               shipping_contact: o.shipping_contact || null,
             }
           };
         }
    }

  let rows = [];

      // Enrich orders with line_items and shipments (concurrency-limited)
      const enriched = await promisePool(
        orders,
        async (order) => {
          const orderIdentifier = order.id || order.order_id || order.orderNumber || order.number;
          const [fullOrder, line_items, shipments] = await Promise.all([
            require('./lib/brightSites').loadOrder(orderIdentifier, storeOpts),
            loadLineItems(orderIdentifier, storeOpts),
            loadShipments(orderIdentifier, storeOpts),
          ]);
          // merge returned fullOrder over the minimal order snapshot so we prefer show-order fields
          const mergedOrder = Object.assign({}, order, fullOrder || {});
          return { order: mergedOrder, line_items, shipments };
        },
        5
      );

  enriched.forEach(({ order, line_items = [], shipments = [] }) => {
    const placed = formatDateMDY(order.placed_at || order.created_at);
        const liMap = new Map();
        line_items.forEach(li => { if (li && li.id != null) liMap.set(String(li.id), li); });

        // Track which line items have been included via shipments
        const processedLineItems = new Set();

        shipments.forEach((s) => {
          // Combine shipment line items from possible shapes
          const rawObjEntries = (s.line_items || []).map(x => (typeof x === 'object') ? x : { id: x });
          const rawIdEntries = (s.line_item_ids || []).map(x => ({ id: x }));
          const combined = [...rawObjEntries, ...rawIdEntries];

          // Aggregate by line item id to avoid duplicates and sum shipped quantities when present
          const agg = new Map(); // liId -> { qtySum:number, hasQty:boolean, sample:entry }
          combined.forEach((entry) => {
            const liId = String(entry.id || entry.line_item_id || entry.item_id || '');
            if (!liId) return;
            const getVal = (obj, ...keys) => { for (const k of keys) { if (!obj) continue; const v = obj[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };
            const rawQty = getVal(entry, 'quantity','qty','shipped_quantity','units','count','amount','shipped_qty');
            const qtyNum = rawQty === '' ? null : Number(rawQty);
            const prev = agg.get(liId) || { qtySum: 0, hasQty: false, sample: entry };
            if (qtyNum != null && !Number.isNaN(qtyNum)) {
              prev.qtySum += qtyNum;
              prev.hasQty = true;
            }
            prev.sample = prev.sample || entry;
            agg.set(liId, prev);
          });

          // If shipment lists no items, skip
          if (agg.size === 0) return;

          const shippingLanded = (s.landed_cost || s.shipping_cost || '') || order.shipping_total || '';
          const shipMethod = (s.shipping_method || order.shipping_method) || '';
          const shipDate = formatDateMDY(s.ship_date || s.shipped_at);
          const tracking = (s.tracking_number || s.tracking || '') || '';

          agg.forEach((info, liId) => {
            processedLineItems.add(liId);
            const li = liMap.get(String(liId)) || { id: liId };
            const pick = (obj, ...keys) => { for (const k of keys) { if (!obj) continue; const v = obj[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };

            const productPersonalization = formatProductPersonalization(li.product_personalizations || li.personalizations || li.personalization || li.product_personalization);
            const originalQty = li.quantity || '';
            const shippedQty = info.hasQty ? String(info.qtySum) : '';
            const productName = li.name || li.product_name || '';
            const productOptions = formatProductOptions(li.options_text || li.product_options || li.options);
            const sku = pick(li, 'final_sku','sku','product_sku','variant_sku','item_sku','sku_code','skuNumber','product_code','code');

            // Contacts and addresses
            const billingMerged = Object.assign({}, order.billing || {}, order.billing_address || {}, order.billing_contact || {});
            const shippingMerged = Object.assign({}, order.shipping || {}, order.shipping_address || {}, order.shipping_contact || {});

            if (!debugInfo) {
              const billingSrc = order.billing_contact || order.billing_address || order.billing || {};
              const shippingSrc = order.shipping_contact || order.shipping_address || order.shipping || {};
              debugInfo = {
                order_id: order.order_id || order.id || null,
                billingSrc,
                shippingSrc,
                representative: s || null,
                order_sample: {
                  customer: order.customer || null,
                  customer_email: order.customer_email || null,
                  billing: order.billing || null,
                  billing_address: order.billing_address || null,
                  shipping: order.shipping || null,
                  shipping_address: order.shipping_address || null,
                }
              };
            }

            // structured fields
            const billingFirst = pick(billingMerged, 'first_name','first','firstName','firstname');
            const billingLast = pick(billingMerged, 'last_name','last','lastName','lastname');
            const billingName = ((billingFirst || billingLast) ? `${billingFirst || ''} ${billingLast || ''}`.trim() : (pick(order, 'customer_name','customer','username') || ''));
            const billingCompany = pick(billingMerged, 'company','business','org');
            const billingAddress1 = pick(billingMerged, 'first_address','address1','firstAddress','address','street1');
            const billingAddress2 = pick(billingMerged, 'second_address','address2','secondAddress','address_line_2','street2');
            const billingCity = pick(billingMerged, 'city','town');
            const billingState = pick(billingMerged, 'state','province','region');
            const billingZip = pick(billingMerged, 'zip','postcode','postal_code');
            const billingCountry = pick(billingMerged, 'country','country_name');
            const billingEmail = pick(billingMerged, 'email','contact_email') || pick(order, 'customer_email','customer');
            const billingPhone = pick(billingMerged, 'phone','telephone','contact_phone') || pick(order, 'customer_phone');

            const shippingFirst = pick(shippingMerged, 'first_name','first','firstName','firstname');
            const shippingLast = pick(shippingMerged, 'last_name','last','lastName','lastname');
            const shippingName = ((shippingFirst || shippingLast) ? `${shippingFirst || ''} ${shippingLast || ''}`.trim() : (pick(order, 'customer_name','customer','username') || ''));
            const shippingCompany = pick(shippingMerged, 'company','business','org');
            const shippingAddress1 = pick(shippingMerged, 'first_address','address1','firstAddress','address','street1');
            const shippingAddress2 = pick(shippingMerged, 'second_address','address2','secondAddress','address_line_2','street2');
            const shippingCity = pick(shippingMerged, 'city','town');
            const shippingState = pick(shippingMerged, 'state','province','region');
            const shippingZip = pick(shippingMerged, 'zip','postcode','postal_code');
            const shippingCountry = pick(shippingMerged, 'country','country_name');
            const shippingEmail = pick(shippingMerged, 'email','contact_email') || pick(order, 'customer_email','customer');
            const shippingPhone = pick(shippingMerged, 'phone','telephone','contact_phone') || pick(order, 'customer_phone');

            rows.push([
              String(order.order_id || order.id || ''),
              placed,
              order.status || '',
              String(li.id || liId || ''),
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
              '', // Billing Month (blank)
              // structured billing
              billingName, billingCompany, billingAddress1, billingAddress2, billingCity, billingState, billingZip, billingCountry, billingEmail, billingPhone,
              // structured shipping
              shippingName, shippingCompany, shippingAddress1, shippingAddress2, shippingCity, shippingState, shippingZip, shippingCountry, shippingEmail, shippingPhone,
            ]);
          });
        });

        // Add line items without shipments (they won't have tracking/ship info)
        line_items.forEach((li) => {
          if (!li || li.id == null) return;
          const liId = String(li.id);
          if (processedLineItems.has(liId)) return; // already included via shipment

          const pick = (obj, ...keys) => { for (const k of keys) { if (!obj) continue; const v = obj[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };

          const productPersonalization = formatProductPersonalization(li.product_personalizations || li.personalizations || li.personalization || li.product_personalization);
          const originalQty = li.quantity || '';
          const productName = li.name || li.product_name || '';
          const productOptions = formatProductOptions(li.options_text || li.product_options || li.options);
          const sku = pick(li, 'final_sku','sku','product_sku','variant_sku','item_sku','sku_code','skuNumber','product_code','code');

          // Contacts and addresses
          const billingMerged = Object.assign({}, order.billing || {}, order.billing_address || {}, order.billing_contact || {});
          const shippingMerged = Object.assign({}, order.shipping || {}, order.shipping_address || {}, order.shipping_contact || {});

          // structured fields
          const billingFirst = pick(billingMerged, 'first_name','first','firstName','firstname');
          const billingLast = pick(billingMerged, 'last_name','last','lastName','lastname');
          const billingName = ((billingFirst || billingLast) ? `${billingFirst || ''} ${billingLast || ''}`.trim() : (pick(order, 'customer_name','customer','username') || ''));
          const billingCompany = pick(billingMerged, 'company','business','org');
          const billingAddress1 = pick(billingMerged, 'first_address','address1','firstAddress','address','street1');
          const billingAddress2 = pick(billingMerged, 'second_address','address2','secondAddress','address_line_2','street2');
          const billingCity = pick(billingMerged, 'city','town');
          const billingState = pick(billingMerged, 'state','province','region');
          const billingZip = pick(billingMerged, 'zip','postcode','postal_code');
          const billingCountry = pick(billingMerged, 'country','country_name');
          const billingEmail = pick(billingMerged, 'email','contact_email') || pick(order, 'customer_email','customer');
          const billingPhone = pick(billingMerged, 'phone','telephone','contact_phone') || pick(order, 'customer_phone');

          const shippingFirst = pick(shippingMerged, 'first_name','first','firstName','firstname');
          const shippingLast = pick(shippingMerged, 'last_name','last','lastName','lastname');
          const shippingName = ((shippingFirst || shippingLast) ? `${shippingFirst || ''} ${shippingLast || ''}`.trim() : (pick(order, 'customer_name','customer','username') || ''));
          const shippingCompany = pick(shippingMerged, 'company','business','org');
          const shippingAddress1 = pick(shippingMerged, 'first_address','address1','firstAddress','address','street1');
          const shippingAddress2 = pick(shippingMerged, 'second_address','address2','secondAddress','address_line_2','street2');
          const shippingCity = pick(shippingMerged, 'city','town');
          const shippingState = pick(shippingMerged, 'state','province','region');
          const shippingZip = pick(shippingMerged, 'zip','postcode','postal_code');
          const shippingCountry = pick(shippingMerged, 'country','country_name');
          const shippingEmail = pick(shippingMerged, 'email','contact_email') || pick(order, 'customer_email','customer');
          const shippingPhone = pick(shippingMerged, 'phone','telephone','contact_phone') || pick(order, 'customer_phone');

          rows.push([
            String(order.order_id || order.id || ''),
            placed,
            order.status || '',
            liId,
            '', // no tracking
            '', // no shipping landed cost
            '', // no ship method
            '', // no ship date
            productPersonalization,
            String(originalQty),
            '', // no shipped quantity
            productName,
            sku,
            productOptions,
            '', // Billing Month (blank)
            // structured billing
            billingName, billingCompany, billingAddress1, billingAddress2, billingCity, billingState, billingZip, billingCountry, billingEmail, billingPhone,
            // structured shipping
            shippingName, shippingCompany, shippingAddress1, shippingAddress2, shippingCity, shippingState, shippingZip, shippingCountry, shippingEmail, shippingPhone,
          ]);
        });
      });

    const meta = { orders: orders.length, rows: rows.length };
    if (debugInfo) meta.debug = debugInfo;
    return res.json({ columns: ALL_COLUMNS, rows, meta });
  } catch (err) {
    console.error('Error /api/run', err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

app.get('/api/stores', (req, res) => {
  const stores = getConfiguredStores();
  // return as array of { key, label, subdomain }
  const out = Object.entries(stores).map(([k, v]) => ({ key: k, label: v.label || k, subdomain: v.subdomain }));
  res.json(out);
});

// Get usage metrics for all stores or a specific store for a month
// GET /api/usage?month=YYYY-MM&store=token
app.get('/api/usage', (req, res) => {
  const month = req.query.month || usage.monthKey();
  const storeKey = req.query.store;
  const stores = getConfiguredStores();
  const monthData = usage.getMonth(month);
  const calc = (count) => usage.metricsFor(count, { freeLimit: FREE_LIMIT, reserve: RESERVE, rate: OVERAGE_RATE });
  if (storeKey) {
    const count = monthData[storeKey] || 0;
    return res.json({ month, store: storeKey, metrics: calc(count) });
  }
  const all = {};
  Object.keys(stores).forEach(k => { all[k] = calc(monthData[k] || 0); });
  // include any orphaned tokens not currently in configured stores
  Object.keys(monthData).forEach(k => { if (!all[k]) all[k] = calc(monthData[k]); });
  res.json({ month, stores: all });
});

// Reset usage for a month (defaults current)
// POST /api/usage/reset { month?: 'YYYY-MM' }
app.post('/api/usage/reset', (req, res) => {
  const body = req.body || {};
  const month = body.month || usage.monthKey();
  usage.reset(month);
  res.json({ ok: true, month });
});
