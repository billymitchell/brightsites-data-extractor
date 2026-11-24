const { getConfiguredStores, storeProgram } = require('../../config/stores');
const { zonedDateString } = require('../../utils/timezone');

// ----- Stores -----------------------------------------------------------------

const STORE_ROLES = {
  product: 'Product (Brand) Store',
  redemption: 'Redemption Store',
  vlr: 'VLR Store',
};

// A store's role comes from its "role" in BRIGHTSITES_STORES, or is recognised from its label/subdomain.
function storeRole(store) {
  if (store.role && STORE_ROLES[store.role]) return store.role;
  const text = `${store.label || ''} ${store.subdomain || ''}`.toLowerCase();
  if (/redemption/.test(text)) return 'redemption';
  if (/\bvlr\b|luxury[\s-]*residence/.test(text)) return 'vlr';
  if (/shop|product|brand/.test(text)) return 'product';
  return null;
}

// With a program, only that program's stores fill roles, so another client's "shop" store is
// never used by an FTG format. Configs that declare no programs at all keep matching every store.
function resolveStoreRoles(stores = getConfiguredStores(), program = '') {
  const out = {};
  const anyProgram = Object.values(stores).some(s => storeProgram(s).id);
  for (const [storeKey, store] of Object.entries(stores)) {
    if (program && anyProgram && storeProgram(store).id !== program) continue;
    const role = storeRole(store);
    if (role && !out[role]) out[role] = { storeKey, store, label: store.label || storeKey };
  }
  return out;
}

// ----- Values -----------------------------------------------------------------

const text = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const money = value => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const quantity = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const isCanceled = order => /cancel/i.test(String(order.status || ''));
const orderNumber = order => {
  const raw = String(order.order_id ?? order.id ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : raw;
};
const placedDate = order => zonedDateString(order.created_at || order.placed_at);
const inRange = (date, range) => Boolean(date) && date >= range.start && date <= range.end;

function contactName(contact) {
  if (!contact) return '';
  return text(`${contact.first_name || ''} ${contact.last_name || ''}`);
}

function customerName(order) {
  return contactName(order.billing_contact) || contactName(order.shipping_contact) || text(order.customer);
}

function addressText(address) {
  if (!address) return '';
  const stateZip = text(`${address.state || ''} ${address.zip || ''}`);
  return [address.company, address.first_address, address.second_address, address.city, stateZip, address.country]
    .map(text).filter(Boolean).join(', ');
}

// ----- Line item details ------------------------------------------------------

function optionPairs(lineItem) {
  const options = lineItem.product_options || lineItem.options;
  if (!Array.isArray(options)) return [];
  return options
    .filter(o => o && (o.option_name || o.name))
    .map(o => [text(o.option_name || o.name), text(o.sub_option_name ?? o.value ?? '')]);
}

function optionsText(lineItem) {
  return optionPairs(lineItem).map(([name, value]) => (value ? `${name}: ${value}` : name)).join(', ');
}

function optionValue(lineItem, ...names) {
  const wanted = names.map(n => n.toLowerCase());
  const hit = optionPairs(lineItem).find(([name]) => wanted.includes(name.toLowerCase()));
  return hit ? hit[1] : '';
}

function personalizations(lineItem) {
  const list = lineItem.product_personalizations || lineItem.personalizations || [];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

// BrightSites' own export layout: the title, then "- key: value" lines.
function personalizationText(lineItem) {
  return personalizations(lineItem).map(p => {
    const lines = (p.attributes || []).filter(Boolean)
      .map(a => `- ${text(a.key || a.name)}: ${text(a.value ?? '')}`);
    return [text(p.title || p.name), ...lines].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

// Matches an attribute key first; otherwise a personalization whose title matches
// (e.g. VLR's "Establishment Name" title with a "Printed Name" attribute).
function personalizationValue(lineItem, ...keys) {
  const wanted = keys.map(k => k.toLowerCase());
  const list = personalizations(lineItem);
  for (const p of list) {
    for (const a of p.attributes || []) {
      if (a && wanted.includes(text(a.key || a.name).toLowerCase())) return text(a.value ?? '');
    }
  }
  for (const p of list) {
    if (!wanted.includes(text(p.title || p.name).toLowerCase())) continue;
    const values = (p.attributes || []).filter(Boolean).map(a => text(a.value ?? '')).filter(Boolean);
    if (values.length) return values.join(' ');
  }
  return '';
}

// ----- Awards -----------------------------------------------------------------

function normalizeAwardType(value) {
  const v = text(value);
  if (/plaque/i.test(v)) return 'Plaque';
  if (/crystal/i.test(v)) return 'Crystal';
  return v;
}

function normalizeAwardLevel(value) {
  const v = text(value);
  if (/\b5\b|five/i.test(v)) return '5-Star';
  if (/\b4\b|four/i.test(v)) return '4-Star';
  if (/^rec/i.test(v)) return 'Rec';
  return v;
}

// Redemption items describe the award in a "Version" option, e.g. "Plaque, 4 Star, 2026, Hotel".
function awardInfo(lineItem) {
  let type = '';
  let level = '';
  let year = '';
  let category = '';
  for (const [name, value] of optionPairs(lineItem)) {
    if (/^version$/i.test(name)) {
      const parts = value.split(',').map(text);
      [type = '', level = '', year = '', category = ''] = parts;
    } else if (/award\s*type/i.test(name)) type = value;
    else if (/award\s*level/i.test(name)) level = value;
  }
  return { type: normalizeAwardType(type), level: normalizeAwardLevel(level), year, category };
}

// ----- Corporate orders -------------------------------------------------------
// Accounting's rule: a corporate order uses the "Purchase Order" payment method AND has a
// payment note mentioning "FTG Accounting". Partial matches (or an @forbestravelguide.com
// customer without both) are "Needs review" so variances are categorised, not silently deducted.

const CORPORATE = 'Corporate';
const NEEDS_REVIEW = 'Needs review';
const CUSTOMER = 'Customer';

function corporateCategory(order) {
  const payment = order.payment || (Array.isArray(order.payments) ? order.payments[0] : null) || {};
  const details = payment.details || {};
  const method = [details['custom method name'], details.method].filter(Boolean).join(' ');
  const note = [details.details, details.note, details.notes].filter(Boolean).join(' ');
  const purchaseOrder = /purchase\s*order/i.test(method);
  const accountingNote = /ftg\s*accounting/i.test(note);
  const ftgEmail = [order.customer_email, order.billing_contact && order.billing_contact.email]
    .some(email => /@forbestravelguide\.com$/i.test(text(email)));
  if (purchaseOrder && accountingNote) {
    return { category: CORPORATE, reason: 'Purchase Order with an FTG Accounting note' };
  }
  if (purchaseOrder || accountingNote || ftgEmail) {
    const found = [purchaseOrder && 'Purchase Order payment', accountingNote && 'FTG Accounting note', ftgEmail && '@forbestravelguide.com email']
      .filter(Boolean).join(' + ');
    const missing = [!purchaseOrder && 'Purchase Order payment', !accountingNote && 'FTG Accounting note'].filter(Boolean).join(' and ');
    return { category: NEEDS_REVIEW, reason: `${found}; missing ${missing}` };
  }
  return { category: CUSTOMER, reason: '' };
}

// ----- Ordering ---------------------------------------------------------------

function compareOrdersDesc(a, b) {
  const x = orderNumber(a.order);
  const y = orderNumber(b.order);
  if (typeof x === 'number' && typeof y === 'number') return y - x;
  return String(y).localeCompare(String(x), undefined, { numeric: true });
}

module.exports = {
  STORE_ROLES, storeRole, resolveStoreRoles,
  text, money, quantity, isCanceled, orderNumber, placedDate, inRange,
  contactName, customerName, addressText,
  optionPairs, optionsText, optionValue, personalizationText, personalizationValue,
  awardInfo, normalizeAwardLevel, normalizeAwardType,
  CORPORATE, NEEDS_REVIEW, CUSTOMER, corporateCategory,
  compareOrdersDesc,
};
