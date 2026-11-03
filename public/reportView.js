(function (root) {
  function planTableView(table, { deselectedColumns = [], splitPairs = false, columnOrder = [] } = {}) {
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
    const originalColumns = keep.map(i => table.columns[i]).concat(headers);
    const order = [...new Set(columnOrder.filter(c => table.columns.includes(c)).concat(table.columns))];
    const rank = new Map(order.map((name, index) => [name, index]));
    function columnRank(name) {
      if (rank.has(name)) return rank.get(name);
      if (name.startsWith('Product Option: ')) return rank.get('Product Options') ?? order.length;
      if (name.startsWith('Product Personalization: ')) return rank.get('Product Personalization') ?? order.length;
      return order.length;
    }
    const indices = originalColumns.map((name, index) => index);
    indices.sort((a, b) => columnRank(originalColumns[a]) - columnRank(originalColumns[b]));
    return { columns: indices.map(i => originalColumns[i]), keep, headers, details, indices };
  }
  function getTableViewColumns(table, options) {
    return planTableView(table, options).columns;
  }
  function buildTableView(table, options) {
    const { columns, keep, headers, details, indices } = planTableView(table, options);
    return { columns, rows: table.rows.map((row, n) => {
      const values = keep.map(i => row[i]).concat(headers.map(h => details[n].get(h) ?? ''));
      return indices.map(i => values[i]);
    }),
      rowKeys: table.rowKeys || [] };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildTableView, getTableViewColumns };
  else root.BrightSitesReportView = { buildTableView, getTableViewColumns };
})(typeof globalThis !== 'undefined' ? globalThis : this);
