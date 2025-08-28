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
  'Product Personalization','Quantity','Product Name','Product Options',
  'Billing Info','Shipping Info'
];

// appended structured columns (kept after the required headers)
const STRUCTURED_COLUMNS = [
  'Billing Name','Billing Company','Billing Address1','Billing Address2','Billing City','Billing State','Billing Zip','Billing Country','Billing Email','Billing Phone',
  'Shipping Name','Shipping Company','Shipping Address1','Shipping Address2','Shipping City','Shipping State','Shipping Zip','Shipping Country','Shipping Email','Shipping Phone'
];

// full columns exposed in API
const ALL_COLUMNS = COLUMNS.concat(STRUCTURED_COLUMNS);

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
    const reportType = body.reportType || 'Needed Excel';
    const dateFilterType = body.dateFilterType || 'created_at';
    const status = body.status;

    const params = {};
    // status filter
    if (status) params.status = status;

    // date range
    if (body.start && body.end) {
      const fromKey = `${dateFilterType}_from`;
      const toKey = `${dateFilterType}_to`;
      params[fromKey] = new Date(body.start).toISOString();
      params[toKey] = new Date(body.end).toISOString();
    }

    // fetch all orders with pagination
  const orders = await fetchAllPages('/orders', params, 200, storeOpts);

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

    if (reportType === 'Needed Excel') {
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
        // if no line items, skip
        line_items.forEach((li) => {
          // find shipments that include this line item
          const tracking = trackingForLineItem({ order, shipments }, li.id);

          // pick a representative shipment for costs/method/date
          let representative = null;
          // prefer shipment that references this line item
          for (const s of shipments) {
            const ids = (s.line_item_ids || []).map(String);
            const sLineItems = (s.line_items || []).map((x) => String(x.id || x));
            if (ids.includes(String(li.id)) || sLineItems.includes(String(li.id))) {
              representative = s;
              break;
            }
          }
          if (!representative && shipments.length) representative = shipments[0];

          const shippingLanded = (representative && (representative.landed_cost || representative.shipping_cost)) || order.shipping_total || '';
          const shipMethod = (representative && (representative.shipping_method || order.shipping_method)) || '';
          const shipDate = (representative && (representative.ship_date || representative.shipped_at)) || '';

          const placed = order.placed_at || order.created_at || '';
          const productPersonalization = formatProductPersonalization(li.product_personalizations || li.personalizations || li.personalization || li.product_personalization);
          const quantity = li.quantity || '';
          const productName = li.name || li.product_name || '';
          const productOptions = formatProductOptions(li.options_text || li.product_options || li.options);

          // Prefer the documented show-order fields (billing_contact, billing_address, shipping_contact, shipping_address)
          const billingSrc = order.billing_contact || order.billing_address || order.billing || {};
          // If billing_contact/address are objects nested under different keys, merge them as a defensive fallback
          const billingMerged = Object.assign({}, order.billing || {}, order.billing_address || {}, order.billing_contact || {});

          const shippingSrc = order.shipping_contact || order.shipping_address || order.shipping || {};
          const shippingMerged = Object.assign({}, order.shipping || {}, order.shipping_address || {}, order.shipping_contact || {});
          // pass representative shipment as extras so composeAddressBlob can use shipment address fallbacks
          // Use merged objects so we capture any fields present under alternative keys
          const billingInfo = composeAddressBlob(billingMerged, order, { order, role: 'billing' });
          const shippingInfo = composeAddressBlob(shippingMerged, order, { shipment: representative, shipments, role: 'shipping' });

          // capture debug info for the first row to help diagnose empty billing/shipping
          if (!debugInfo) {
            debugInfo = {
              order_id: order.order_id || order.id || null,
              billingSrc,
              shippingSrc,
              representative: representative || null,
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

          // helper to pick from merged sources with aliases
          const pick = (obj, ...keys) => {
            for (const k of keys) {
              if (!obj) continue;
              const v = obj[k];
              if (v !== undefined && v !== null && String(v).trim() !== '') return v;
            }
            return '';
          };

          // extract structured billing fields from billingMerged or order fallbacks
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

          // extract structured shipping fields from shippingMerged or shipment/order fallbacks
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
            String(li.id || ''),
            tracking,
            shippingLanded,
            shipMethod,
            shipDate,
            productPersonalization,
            String(quantity),
            productName,
            productOptions,
            billingInfo,
            shippingInfo,
            // structured billing
            billingName, billingCompany, billingAddress1, billingAddress2, billingCity, billingState, billingZip, billingCountry, billingEmail, billingPhone,
            // structured shipping
            shippingName, shippingCompany, shippingAddress1, shippingAddress2, shippingCity, shippingState, shippingZip, shippingCountry, shippingEmail, shippingPhone,
          ]);
        });
      });
    } else {
      // For other report types, return a simple one-row-per-order summary mapping some columns.
      rows = orders.slice(0).map((order) => {
        const billingInfo = composeAddressBlob(order.billing || order.billing_address || {}, order);
        const shippingInfo = composeAddressBlob(order.shipping || order.shipping_address || {}, order);
        // minimal structured fallbacks
        const pick = (obj, ...keys) => { for (const k of keys) { if (!obj) continue; const v = obj[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };
        const billingMerged = Object.assign({}, order.billing || {}, order.billing_address || {}, order.billing_contact || {});
        const shippingMerged = Object.assign({}, order.shipping || {}, order.shipping_address || {}, order.shipping_contact || {});
        const billingName = (pick(billingMerged,'first_name','first') || pick(order,'customer','username') || '');
        const shippingName = (pick(shippingMerged,'first_name','first') || pick(order,'customer','username') || '');
        const structured = [billingName,'','','','','','','', pick(billingMerged,'email','contact_email') || pick(order,'customer_email','customer'),'', shippingName,'','','','','','','', pick(shippingMerged,'email','contact_email') || pick(order,'customer_email','customer'),''];
        return [
          String(order.order_id || order.id || ''),
          order.placed_at || order.created_at || '',
          order.status || '',
          '', // Line Item ID
          '', // Tracking
          order.shipping_total || '',
          order.shipping_method || '',
          '', // Ship Date
          '', // Product Personalization
          '', // Quantity
          '', // Product Name
          '', // Product Options
          billingInfo,
          shippingInfo,
        ].concat(structured);
      });
    }

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
