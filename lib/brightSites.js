const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config();
const usage = require('./usage');
const { logError, logWarn } = require('../utils/logger');

const SUBDOMAIN = process.env.BRIGHTSITES_SUBDOMAIN;
const TOKEN = process.env.BRIGHTSITES_API_TOKEN;
const HAS_MULTI_STORE_CONFIG = Boolean(process.env.BRIGHTSITES_STORES);
const HAS_LEGACY_SINGLE_STORE_CONFIG = Boolean(SUBDOMAIN && TOKEN);

if (!HAS_MULTI_STORE_CONFIG && !HAS_LEGACY_SINGLE_STORE_CONFIG) {
  logWarn(
    'lib/brightSites.init',
    'No BrightSites configuration found. Set BRIGHTSITES_STORES for multi-store mode or BRIGHTSITES_SUBDOMAIN and BRIGHTSITES_API_TOKEN for single-store mode.'
  );
}

const BASE = `https://${SUBDOMAIN}.mybrightsites.com/api/v2.6.1`;
const SAFE_RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number(process.env.BRIGHTSITES_RATE_LIMIT_PER_MINUTE || 900)
);
const MIN_REQUEST_INTERVAL_MS = Math.ceil(60000 / SAFE_RATE_LIMIT_PER_MINUTE);

const nextRequestAtByToken = new Map();
const requestGateByToken = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tokenKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('token') || 'default';
  } catch (e) {
    logWarn('lib/brightSites.tokenKeyFromUrl', 'Failed to parse URL for token key', {
      url,
      error: e.message,
    });
    return 'default';
  }
}

function noteUsage(url) {
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    if (token) usage.increment(token, 1);
  } catch (e) {
    logWarn('lib/brightSites.noteUsage', 'Failed to record usage for request URL', {
      url,
      error: e.message,
    });
  }
}

function retryAfterMs(res) {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

async function waitForRequestSlot(tokenKey) {
  const previousGate = requestGateByToken.get(tokenKey) || Promise.resolve();
  let releaseGate;
  const currentGate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  requestGateByToken.set(
    tokenKey,
    previousGate.then(() => currentGate).catch(() => currentGate)
  );

  await previousGate.catch(() => {});

  const now = Date.now();
  const nextAllowedAt = nextRequestAtByToken.get(tokenKey) || now;
  const waitMs = Math.max(0, nextAllowedAt - now);
  nextRequestAtByToken.set(
    tokenKey,
    Math.max(now, nextAllowedAt) + MIN_REQUEST_INTERVAL_MS
  );
  releaseGate();

  if (waitMs > 0) await sleep(waitMs);
}

function pushBackRequestSlot(tokenKey, waitMs) {
  if (!waitMs || waitMs <= 0) return;
  const nextAllowedAt = Date.now() + waitMs;
  const existing = nextRequestAtByToken.get(tokenKey) || 0;
  nextRequestAtByToken.set(tokenKey, Math.max(existing, nextAllowedAt));
}

async function safeFetch(url, opts = {}, retries = 4, delay = 1000) {
  const tokenKey = tokenKeyFromUrl(url);
  for (let i = 0; i <= retries; i++) {
    try {
      await waitForRequestSlot(tokenKey);
      const res = await fetch(url, opts);
      // Count each network attempt as a billable outgoing API request.
      noteUsage(url);
      if (res.ok) return res;
      const txt = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} ${res.statusText} - ${txt}`);
      if (res.status === 429) {
        const backoffMs = retryAfterMs(res) || Math.min(60000, delay * Math.pow(2, i + 2));
        pushBackRequestSlot(tokenKey, backoffMs);
        if (i === retries) throw err;
        logWarn('lib/brightSites.safeFetch', 'BrightSites rate limit hit; retrying request', {
          url,
          backoffMs,
          attempt: i + 1,
        });
        await sleep(backoffMs);
        continue;
      }
      if (i === retries) throw err;
    } catch (err) {
      if (i === retries) {
        logError('lib/brightSites.safeFetch', err, {
          url,
          attempt: i + 1,
        });
      }
      if (i === retries) throw err;
    }
    await sleep(Math.min(30000, delay * Math.pow(2, i)));
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
    logError('lib/brightSites.loadLineItems', err, { orderId });
    return [];
  }
}

async function loadShipments(orderId, opts = {}) {
  if (!orderId) return [];
  try {
    return await fetchAllPages(`/orders/${orderId}/shipments`, {}, 200, opts);
  } catch (err) {
    logError('lib/brightSites.loadShipments', err, { orderId });
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
    logError('lib/brightSites.loadOrder', err, { orderId });
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
