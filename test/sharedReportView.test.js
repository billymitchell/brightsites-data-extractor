const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTableView } = require('../public/reportView');
test('new dynamic keys after the preview limit remain in the full view and keys stay aligned', () => {
  const table = { columns: ['Order #', 'Product Options'], rows: Array.from({ length: 51 }, (_, i) => [String(i), '']),
    rowKeys: Array.from({ length: 51 }, (_, i) => `shop:${i}`), rowDetails: Array.from({ length: 51 }, (_, i) => ({ options: i === 50 ? [['Product Option: Late Key', 'Matte']] : [] })) };
  const view = buildTableView(table, { splitPairs: true });
  assert.deepEqual(view.columns, ['Order #', 'Product Option: Late Key']);
  assert.equal(view.rows[0][1], '');
  assert.equal(view.rows[50][1], 'Matte');
  assert.equal(view.rowKeys[50], 'shop:50');
});
test('selected columns hide whole split groups and preserve all row keys', () => {
  const view = buildTableView({ columns: ['Order #', 'Product Options'], rows: [['1', 'Finish: Matte']], rowKeys: ['shop:1'], rowDetails: [{ options: [['Product Option: Finish', 'Matte']] }] }, { deselectedColumns: ['Product Options'], splitPairs: true });
  assert.deepEqual(view, { columns: ['Order #'], rows: [['1']], rowKeys: ['shop:1'] });
});
