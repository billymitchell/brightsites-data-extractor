const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTableView } = require('../public/reportView');

test('preview row limit still discovers columns from every row', () => {
  const table = {
    columns: ['Order #', 'Product Options'],
    rows: [['1', ''], ['2', ''], ['3', '']],
    rowDetails: [{ options: [] }, { options: [] }, { options: [['Product Option: Color', 'Red']] }],
    rowKeys: ['a', 'b', 'c'],
  };
  const view = buildTableView(table, { splitPairs: true, rowLimit: 1 });
  assert.equal(view.rows.length, 1);
  assert.equal(view.totalRows, 3);
  assert.ok(view.columns.includes('Product Option: Color'));
  assert.equal(view.rows[0].length, view.columns.length);
  assert.equal(buildTableView(table, { splitPairs: true }).rows.length, 3);
});
