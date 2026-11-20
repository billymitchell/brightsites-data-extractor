const test = require('node:test');
const assert = require('node:assert/strict');
const { getReportColumnConfig } = require('../config/report');
const { buildOrderReportEntry } = require('../services/orderRowBuilder');
const fixture = require('./helpers/reportFixture');
const columns = getReportColumnConfig('order').columns;
function fields(entry) { return Object.fromEntries(columns.map((c, i) => [c, entry.row[i]])); }
test('summarizes original items and distinct shipments without multiplying totals', () => {
  const entry = buildOrderReportEntry({ ...fixture, line_items: [...fixture.line_items, fixture.line_items[0]], shipments: [...fixture.shipments, fixture.shipments[0]] });
  const f = fields(entry);
  assert.equal(entry.row.length, columns.length);
  assert.equal(f['Order #'], '00100');
  assert.equal(f['Order Total'], '125.00');
  assert.equal(f['Unique Item Count'], 2);
  assert.equal(f['Original Quantity'], 5);
  assert.equal(f['Shipped Quantity'], 5);
  assert.equal(f['Shipment Count'], 2);
  assert.equal(f['Tracking #'], '0000123; 0000456');
  assert.equal(f['First Ship Date'], '02/01/2026');
  assert.equal(f['Last Ship Date'], '02/02/2026');
  assert.deepEqual(entry.rowDetails.options, [['Product Option: Finish', 'Matte; Glossy'], ['Product Option: New Key', 'Late Value']]);
});

test('order personalization summaries contain distinct readable values without line-item IDs', () => {
  const names = ['The Miami Beach EDITION', 'Matador Room', 'The Spa at The Miami Beach EDITION', 'Matador Room'];
  const entry = buildOrderReportEntry({ order: { id: 2505 }, line_items: names.map((value, index) => ({
    id: 46199084 + index, quantity: 1, name: 'Plaque', final_sku: 'same-sku',
    product_personalizations: [{ title: 'Establishment Details', attributes: [{ key: 'Official Establishment Name', value }] }],
  })) });
  assert.deepEqual(entry.rowDetails.personalization, [[
    'Product Personalization: Establishment Details: Official Establishment Name',
    'The Miami Beach EDITION; Matador Room; The Spa at The Miami Beach EDITION',
  ]]);
  const f = fields(entry);
  assert.equal(f['Product Name'], 'Plaque');
  assert.equal(f.SKU, 'same-sku');
  assert.equal(f['Unique Item Count'], 4);
});

test('order Version summaries split each field without changing the original unsplit text', () => {
  const versions = ['Plaque, 4 Star, 2026, Hotel', 'Plaque, Recommended, 2026, Restaurant', 'Plaque, 4 Star, 2026, Spa'];
  const entry = buildOrderReportEntry({ order: { id: 2505 }, line_items: versions.map((value, index) => ({
    id: 46199084 + index, quantity: 1, product_options: [{ option_name: 'Version', sub_option_name: value }],
  })) });
  assert.deepEqual(entry.rowDetails.options, [
    ['Product Option: Product Type', 'Plaque'], ['Product Option: Award Level', '4 Star; Recommended'],
    ['Product Option: Year', '2026'], ['Product Option: Category', 'Hotel; Restaurant; Spa'],
  ]);
  assert.equal(fields(entry)['Product Options'], `Version: ${versions.join('; ')}`);
});
test('empty collections produce one order entry with zero counts', () => {
  const f = fields(buildOrderReportEntry({ order: fixture.order }));
  for (const key of ['Unique Item Count', 'Original Quantity', 'Shipped Quantity', 'Shipment Count']) assert.equal(f[key], 0);
});
test('unknown quantities remain blank while real zero stays zero', () => {
  for (const qty of [undefined, '', 'bad', Infinity, -1]) {
    const f = fields(buildOrderReportEntry({ order: fixture.order, line_items: [{ id: 7, quantity: qty }], shipments: [{ line_items: [{ id: 7, quantity: qty }] }] }));
    assert.equal(f['Original Quantity'], '');
    assert.equal(f['Shipped Quantity'], '');
  }
  const f = fields(buildOrderReportEntry({ order: fixture.order, line_items: [{ id: 7, quantity: 0 }], shipments: [{ line_items: [{ id: 7, quantity: 0 }] }] }));
  assert.equal(f['Original Quantity'], 0);
  assert.equal(f['Shipped Quantity'], 0);
});
test('shipments without IDs remain distinct even when their tracking matches', () => {
  const shipments = [{ tracking_number: 'x', line_items: [{ id: 7, quantity: 1 }] }, { tracking_number: 'x', line_items: [{ id: 7, quantity: 2 }] }];
  const f = fields(buildOrderReportEntry({ ...fixture, shipments }));
  assert.equal(f['Shipment Count'], 2);
  assert.equal(f['Shipped Quantity'], 3);
  assert.equal(f['Tracking #'], 'x');
});

test('a missing allocation cannot be hidden by a known quantity for the same item', () => {
  const f = fields(buildOrderReportEntry({ ...fixture, shipments: [{ id: 'a', line_items: [{ id: 7, quantity: 1 }, { id: 7 }] }] }));
  assert.equal(f['Shipped Quantity'], '');
});

test('zero source shipping cost takes priority over nonzero fallback amounts', () => {
  const f = fields(buildOrderReportEntry({ order: { id: 1, shipment: { cost: 0 }, shipping_total: 25 } }));
  assert.equal(f['Store Shipping Cost'], 0);
});

test('invalid calendar shipment dates do not suppress valid date extrema', () => {
  const f = fields(buildOrderReportEntry({ order: { id: 1 }, shipments: [{ ship_date: '2026-03-01' }, { ship_date: '2026-02-30' }] }));
  assert.equal(f['First Ship Date'], '03/01/2026');
  assert.equal(f['Last Ship Date'], '03/01/2026');
});
