const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config();

const SUBDOMAIN = process.env.BRIGHTSITES_SUBDOMAIN;
const TOKEN = process.env.BRIGHTSITES_API_TOKEN;
if (!SUBDOMAIN || !TOKEN) {
  // don't throw here to allow local dev, but warn
  console.warn('BRIGHTSITES_SUBDOMAIN or BRIGHTSITES_API_TOKEN not set in env');
}

const BASE = `https://${SUBDOMAIN}.mybrightsites.com/api/v2.6.1`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url, opts = {}, retries = 2, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      const txt = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} ${res.statusText} - ${txt}`);
      if (i === retries) throw err;
    } catch (err) {
      if (i === retries) throw err;
    }
    await sleep(delay);
  }
}

async function fetchAllPages(path, params = {}, pageSize = 200, opts = {}) {
  const out = [];
  let page = 1;
  while (true) {
  const token = opts.token || TOKEN;
  const subdomain = opts.subdomain || SUBDOMAIN;
  const base = subdomain ? `https://${subdomain}.mybrightsites.com/api/v2.6.1` : BASE;
  const p = Object.assign({}, params, { page, per_page: pageSize, token });
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
  const url = `${base}${path}?${qs.toString()}`;
    const res = await safeFetch(url, { method: 'GET' });
    if (!res) break;
    const json = await res.json();
    // Accept several response shapes: top-level array, or object with an array under common keys
    let arr = [];
    if (Array.isArray(json)) {
      arr = json;
    } else if (json && typeof json === 'object') {
      if (Array.isArray(json.orders)) arr = json.orders;
      else if (Array.isArray(json.items)) arr = json.items;
      else if (Array.isArray(json.data)) arr = json.data;
      else if (Array.isArray(json.results)) arr = json.results;
      else {
        // fallback: find first array-valued property
        for (const v of Object.values(json)) {
          if (Array.isArray(v)) { arr = v; break; }
        }
      }
    }
    if (!arr || arr.length === 0) break;
    out.push(...arr);
    if (arr.length < pageSize) break;
    page += 1;
  }
  return out;
}

async function loadLineItems(orderId, opts = {}) {
  if (!orderId) return [];
  try {
    return await fetchAllPages(`/orders/${orderId}/line_items`, {}, 200, opts);
  } catch (err) {
    console.warn('loadLineItems error', err.message);
    return [];
  }
}

async function loadShipments(orderId, opts = {}) {
  if (!orderId) return [];
  try {
    return await fetchAllPages(`/orders/${orderId}/shipments`, {}, 200, opts);
  } catch (err) {
    console.warn('loadShipments error', err.message);
    return [];
  }
}

async function loadOrder(orderId, opts = {}) {
  if (!orderId) return {};
  try {
    const token = opts.token || TOKEN;
    const subdomain = opts.subdomain || SUBDOMAIN;
    const base = subdomain ? `https://${subdomain}.mybrightsites.com/api/v2.6.1` : BASE;
    const qs = new URLSearchParams({ token });
    const url = `${base}/orders/${orderId}?${qs.toString()}`;
    const res = await safeFetch(url, { method: 'GET' });
    if (!res) return {};
    const json = await res.json();
    // API returns the order object directly
    return json || {};
  } catch (err) {
    console.warn('loadOrder error', err.message);
    return {};
  }
}

function joinNonEmpty(parts, sep = ' | ') {
  return parts.filter((p) => p !== undefined && p !== null && String(p).trim() !== '').join(sep);
}

function composeAddressBlob(addr = {}, order = {}, extras = {}) {
  // addr may contain many shapes; accept contact objects on order as fallback
  // extras.role may be 'billing' or 'shipping' to prefer the correct order fields
  // prefer values from addr, then addr-aliases, then order-level contact/address
  const role = extras && extras.role ? extras.role : 'auto';
  const get = (obj, ...keys) => {
    for (const k of keys) {
      if (!obj) continue;
      if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
    }
    return '';
  };

  // contact may be provided separately on order (shipping_contact / billing_contact)
  let contactFallback = {};
  if (role === 'billing') contactFallback = order.billing_contact || order.shipping_contact || {};
  else if (role === 'shipping') contactFallback = order.shipping_contact || order.billing_contact || {};
  else contactFallback = order.shipping_contact || order.billing_contact || {};
  const contact = (addr && (addr.first_name || addr.last_name || addr.email || addr.phone)) ? addr : contactFallback;
  const orderAddr = (role === 'billing') ? (order.billing_address || order.shipping_address || {}) : ((role === 'shipping') ? (order.shipping_address || order.billing_address || {}) : (order.shipping_address || order.billing_address || {}));
  // extras may include a shipment object with address info we can use as a fallback
  const shipment = extras && (extras.shipment || (Array.isArray(extras.shipments) && extras.shipments[0])) ? (extras.shipment || (Array.isArray(extras.shipments) && extras.shipments[0])) : null;
  const shipmentAddr = shipment ? (shipment.shipping_address || shipment.address || shipment.to_address || shipment.recipient || {}) : {};

  const first = get(addr, 'first_name', 'first', 'firstName', 'firstname') || get(contact, 'first_name', 'first', 'firstName', 'firstname');
  const last = get(addr, 'last_name', 'last', 'lastName', 'lastname') || get(contact, 'last_name', 'last', 'lastName', 'lastname');
  const name = joinNonEmpty([ (first || last) ? `${(first||'').trim()} ${(last||'').trim()}`.trim() : '' ]);

  // if no first/last found, try order-level name fallbacks
  let finalName = name;
  if (!finalName) {
    const oName = get(order, 'customer_name', 'customer', 'customer_full_name', 'customerDisplayName');
    if (oName) finalName = String(oName).trim();
  }
  // if still missing, try shipment recipient fields
  if (!finalName && shipment) {
    const sName = get(shipmentAddr, 'name', 'recipient_name', 'to_name', 'recipient', 'full_name');
    if (sName) finalName = String(sName).trim();
  }

  const company = get(addr, 'company', 'business', 'org') || get(orderAddr, 'company') || get(shipmentAddr, 'company');
  const address1 = get(addr, 'address1', 'first_address', 'firstAddress', 'address', 'street1') || get(orderAddr, 'first_address', 'firstAddress', 'address1', 'street1') || get(shipmentAddr, 'address1', 'first_address', 'address', 'street1') || '';
  const address2 = get(addr, 'address2', 'second_address', 'secondAddress', 'address_line_2', 'street2') || get(orderAddr, 'second_address', 'secondAddress', 'address2') || get(shipmentAddr, 'address2', 'second_address') || '';
  const addrLine = joinNonEmpty([address1, address2], ' ');
  const city = get(addr, 'city', 'town') || get(orderAddr, 'city') || get(shipmentAddr, 'city') || '';
  const state = get(addr, 'state', 'province', 'region') || get(orderAddr, 'state') || get(shipmentAddr, 'state') || '';
  const zip = get(addr, 'zip', 'postcode', 'postal_code') || get(addr, 'postal') || get(orderAddr, 'zip', 'postcode', 'postal_code') || get(shipmentAddr, 'zip', 'postal_code') || '';
  const cityStateZip = joinNonEmpty([city, [state, zip].filter(Boolean).join(' ').trim()].filter(Boolean), ', ');
  const country = get(addr, 'country', 'country_name') || get(orderAddr, 'country') || get(shipmentAddr, 'country') || '';

  // email/phone: try addr, then contact, then order
  const email = get(addr, 'email', 'contact_email') || get(contact, 'email') || get(order, 'customer_email') || get(order, 'customer') || get(shipmentAddr, 'email') || '';
  const phone = get(addr, 'phone', 'telephone', 'contact_phone') || get(contact, 'phone') || get(order, 'customer_phone') || '';

  const parts = [];
  if (finalName) parts.push(finalName);
  if (company) parts.push(company);
  if (addrLine) parts.push(addrLine);
  if (cityStateZip) parts.push(cityStateZip);
  if (country) parts.push(country);
  if (email) parts.push(email);
  if (phone) parts.push(phone);
  return parts.join(' | ');
}

function trackingForLineItem({ order, shipments } = {}, lineItemId) {
  if (!shipments || shipments.length === 0) return '';
  const found = new Set();
  shipments.forEach((s) => {
    const t = s.tracking_number || s.tracking || '';
    if (!t) return;
    // if shipment enumerates line items
    const ids = (s.line_item_ids || []).map(String);
    const sLineItems = (s.line_items || []).map((x) => String(x.id || x));
    if (ids.includes(String(lineItemId)) || sLineItems.includes(String(lineItemId))) {
      found.add(t);
    }
  });
  if (found.size > 0) return Array.from(found).join('; ');

  // fallback to any shipment tracking at order level
  const any = shipments.map((s) => s.tracking_number || s.tracking || '').filter(Boolean);
  if (any.length > 0) return Array.from(new Set(any)).join('; ');
  return '';
}

module.exports = {
  fetchAllPages,
  loadLineItems,
  loadShipments,
  loadOrder,
  composeAddressBlob,
  trackingForLineItem,
};
