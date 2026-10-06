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
    return opts.map((o) => {
      if (o == null) return '';
      if (typeof o === 'string') return o;
      if (o.option_name || o.sub_option_name) {
        const name = o.option_name || o.name || '';
        const sub = o.sub_option_name || o.value || o.sub || '';
        return [name, sub].filter(Boolean).join(': ');
      }
      try {
        return JSON.stringify(o);
      } catch (e) {
        return String(o);
      }
    }).filter(Boolean).join('; ');
  }
  if (typeof opts === 'object') {
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
  return arr.map((item) => {
    if (!item) return '';
    const title = item.title || item.name || '';
    let attrs = '';
    if (Array.isArray(item.attributes)) {
      attrs = item.attributes.map((a) => {
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

function addPair(pairs, header, value) {
  if (value == null || value === '') return;
  const found = pairs.find((p) => p[0] === header);
  if (found) found[1] += '; ' + String(value);
  else pairs.push([header, String(value)]);
}

function extractOptionPairs(opts) {
  const pairs = [];
  if (!opts) return pairs;
  const prefix = 'Product Option: ';
  if (typeof opts === 'string') {
    opts.split(';').map((t) => t.trim()).filter(Boolean).forEach((part) => {
      const i = part.indexOf(':');
      if (i > 0) addPair(pairs, prefix + part.slice(0, i).trim(), part.slice(i + 1).trim());
      else addPair(pairs, prefix + part, part);
    });
    return pairs;
  }
  if (Array.isArray(opts)) {
    opts.forEach((o) => {
      if (o == null) return;
      if (typeof o === 'string') {
        extractOptionPairs(o).forEach(([k, v]) => addPair(pairs, k, v));
        return;
      }
      const name = o.option_name || o.name || '';
      const sub = o.sub_option_name || o.value || o.sub || '';
      if (name) addPair(pairs, prefix + name, sub);
    });
    return pairs;
  }
  if (typeof opts === 'object') {
    Object.entries(opts).forEach(([k, v]) => addPair(pairs, prefix + k, v));
  }
  return pairs;
}

function extractPersonalizationPairs(pp) {
  const pairs = [];
  if (!pp) return pairs;
  const prefix = 'Product Personalization: ';
  if (typeof pp === 'string') {
    addPair(pairs, 'Product Personalization', pp);
    return pairs;
  }
  const arr = Array.isArray(pp) ? pp : (pp.personalizations || pp.product_personalizations || []);
  if (!Array.isArray(arr)) return pairs;
  arr.forEach((item) => {
    if (!item) return;
    const title = item.title || item.name || '';
    if (Array.isArray(item.attributes)) {
      item.attributes.forEach((a) => {
        if (typeof a === 'string') { addPair(pairs, prefix + (title || a), a); return; }
        const k = a.key || a.name || '';
        const v = a.value || a.val || '';
        const header = !k || k === title ? (title || k) : (title ? `${title}: ${k}` : k);
        if (header) addPair(pairs, prefix + header, v);
      });
    }
    if (item.price_modifier && title) {
      const pt = item.price_modifier.modifier_type || item.price_modifier.type || '';
      const amt = item.price_modifier.amount || item.price_modifier.value || '';
      if (pt || amt) addPair(pairs, `${prefix}${title} Price`, `${pt}${amt}`);
    }
  });
  return pairs;
}

module.exports = {
  extractOptionPairs,
  extractPersonalizationPairs,
  formatDateMDY,
  formatProductOptions,
  formatProductPersonalization,
};
