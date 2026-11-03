const nodeFetch = require('node-fetch');
const { getReportColumnConfig } = require('../config/report');
const { UPS_COLUMNS } = require('../lib/ups');

function validateLayout(level, layout) {
  if (!['order', 'shipment'].includes(level)) throw Object.assign(new Error('Invalid report level.'), { statusCode: 400 });
  const allowed = new Set(getReportColumnConfig(level).groups.flatMap(group => group.columns)
    .concat(level === 'shipment' ? UPS_COLUMNS : []));
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)
    || Object.keys(layout).some(key => !['deselectedColumns', 'columnOrder', 'splitPairs'].includes(key))
    || typeof layout.splitPairs !== 'boolean') {
    throw Object.assign(new Error('Invalid column layout.'), { statusCode: 400 });
  }
  for (const key of ['deselectedColumns', 'columnOrder']) {
    const values = layout[key];
    if (!Array.isArray(values) || values.length > allowed.size
      || values.some(value => typeof value !== 'string' || !allowed.has(value))
      || new Set(values).size !== values.length) {
      throw Object.assign(new Error(`${key} must contain unique report column names.`), { statusCode: 400 });
    }
  }
  return { deselectedColumns: [...layout.deselectedColumns], columnOrder: [...layout.columnOrder], splitPairs: layout.splitPairs };
}

function createColumnPreferenceService({ url, key, fetchImpl = nodeFetch }) {
  async function request(query, options = {}) {
    if (!url || !key) throw Object.assign(new Error('Account column storage is not configured. Contact the administrator.'), { statusCode: 503 });
    let response;
    try {
      response = await fetchImpl(`${url}/rest/v1/report_column_preferences?${query}`, {
        timeout: 15000,
        ...options,
        headers: {
          apikey: key,
          ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch {
      throw Object.assign(new Error('Account column storage is unavailable. Please retry.'), { statusCode: 503 });
    }
    if (!response.ok) throw Object.assign(new Error('Could not access account column defaults. Check storage configuration or retry.'), { statusCode: 503 });
    return response;
  }
  return {
    async load(email) {
      const query = new URLSearchParams({ email: `eq.${email}`, select: 'report_level,layout' });
      const response = await request(query);
      let rows;
      try { rows = await response.json(); } catch {
        throw Object.assign(new Error('Account column storage returned an invalid response.'), { statusCode: 502 });
      }
      if (!Array.isArray(rows) || rows.length > 2) throw new Error('Invalid stored column layouts.');
      const layouts = {};
      for (const row of rows) {
        if (!row || Object.hasOwn(layouts, row.report_level)) throw new Error('Invalid stored column layouts.');
        layouts[row.report_level] = validateLayout(row.report_level, row.layout);
      }
      return layouts;
    },
    async save(email, level, layout) {
      const validated = validateLayout(level, layout);
      await request('on_conflict=email,report_level', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ email, report_level: level, layout: validated, updated_at: new Date().toISOString() }),
      });
    },
  };
}

module.exports = { createColumnPreferenceService, validateLayout };
