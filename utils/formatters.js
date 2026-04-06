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

module.exports = {
  formatDateMDY,
  formatProductOptions,
  formatProductPersonalization,
};
