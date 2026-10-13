const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportLevel, getReportColumnConfig, ALL_COLUMNS } = require('../config/report');
test('report levels default to shipment and validate supported modes', () => {
  assert.equal(normalizeReportLevel(), 'shipment');
  for (const mode of ['order', 'shipment', 'both']) assert.equal(normalizeReportLevel(mode), mode);
  for (const mode of ['', null, [], {}, 'other']) assert.throws(() => normalizeReportLevel(mode), { statusCode: 400 });
});
test('each concrete report has its own eligible columns and core selection', () => {
  assert.deepEqual(getReportColumnConfig().columns, ALL_COLUMNS);
  const order = getReportColumnConfig('order');
  assert.ok(order.columns.includes('Unique Item Count'));
  assert.ok(order.columns.includes('First Ship Date'));
  assert.ok(!order.columns.includes('Unit Price'));
  assert.ok(!order.columns.includes('Line Item ID'));
  assert.ok(order.core.every(c => order.columns.includes(c)));
  assert.equal(new Set(order.columns).size, order.columns.length);
  assert.throws(() => getReportColumnConfig('both'), { statusCode: 400 });
});
