(function (root) {
  function planTableView(table, { deselectedColumns = [], splitPairs = false } = {}) {
    const hidden = new Set(deselectedColumns);
    const split = splitPairs && Array.isArray(table.rowDetails);
    const keep = table.columns.map((name, i) => i).filter(i => !hidden.has(table.columns[i])
      && !(split && ['Product Personalization', 'Product Options'].includes(table.columns[i])));
    const headers = [], seen = new Set();
    const details = Array.from({ length: table.rows.length }, (_, index) => {
      const values = new Map();
      if (split) {
        const detail = table.rowDetails[index] || {};
        const pairs = (!hidden.has('Product Personalization') && table.columns.includes('Product Personalization') ? detail.personalization || [] : [])
          .concat(!hidden.has('Product Options') && table.columns.includes('Product Options') ? detail.options || [] : []);
        for (const [key, value] of pairs) {
          values.set(key, value);
          if (!seen.has(key)) { seen.add(key); headers.push(key); }
        }
      }
      return values;
    });
    headers.sort((a, b) => Number(a.startsWith('Product Option')) - Number(b.startsWith('Product Option')));
    return { columns: keep.map(i => table.columns[i]).concat(headers), keep, headers, details };
  }
  function getTableViewColumns(table, options) {
    return planTableView(table, options).columns;
  }
  function buildTableView(table, options) {
    const { columns, keep, headers, details } = planTableView(table, options);
    return { columns, rows: table.rows.map((row, n) => keep.map(i => row[i]).concat(headers.map(h => details[n].get(h) ?? ''))),
      rowKeys: table.rowKeys || [] };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildTableView, getTableViewColumns };
  else root.BrightSitesReportView = { buildTableView, getTableViewColumns };
})(typeof globalThis !== 'undefined' ? globalThis : this);
