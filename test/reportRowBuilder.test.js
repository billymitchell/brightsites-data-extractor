const test = require('node:test');
const assert = require('node:assert/strict');

const brightSites = require('../lib/brightSites');
let orderData;
let lineItems;
brightSites.loadOrder = async () => orderData;
brightSites.loadLineItems = async () => lineItems;
brightSites.loadShipments = async () => [];

const { COLUMNS, ALL_COLUMNS } = require('../config/report');
const { buildReportRows } = require('../services/reportRowBuilder');

test('builds price and tax fields in their configured report columns', async () => {
  orderData = { total: 30 };
  lineItems = [{
    id: 7,
    quantity: 2,
    unit_price: 12.5,
    total_price: 25,
    tax_total: 2,
  }];
  const { rows } = await buildReportRows({ orders: [{ id: 1 }], storeOpts: {} });
  const row = rows[0];

  assert.equal(row.length, ALL_COLUMNS.length);
  assert.equal(row[COLUMNS.indexOf('Unit Price')], 12.5);
  assert.equal(row[COLUMNS.indexOf('Total Price')], 25);
  assert.equal(row[COLUMNS.indexOf('Tax Total')], 2);
  assert.equal(row[COLUMNS.indexOf('Order Total')], 30);
});

test('leaves absent monetary fields blank', async () => {
  orderData = {};
  lineItems = [{ id: 8, quantity: 1 }];
  const { rows } = await buildReportRows({ orders: [{ id: 2 }], storeOpts: {} });
  const row = rows[0];

  for (const column of ['Unit Price', 'Total Price', 'Tax Total', 'Order Total']) {
    assert.equal(row[COLUMNS.indexOf(column)], '', column);
  }
});

test('rejects reports that exceed the configured row limit', async () => {
  orderData = {};
  lineItems = [{ id: 8 }, { id: 9 }];
  await assert.rejects(
    buildReportRows({ orders: [{ id: 2 }], storeOpts: {}, maxRows: 1 }),
    /Report exceeds the maximum of 1 rows/
  );
});

test('tax and shipping come from BrightSites tax_price and adjustments', () => {
  const { extractOrderAmounts } = require('../services/reportRowBuilder');
  const a = extractOrderAmounts({
    required_adjustments: [
      { note: 'sales tax', amount: '7.88' },
      { note: 'shipment', amount: '25.55' },
      { note: 'shipping sales tax', amount: '2.68' },
    ],
    custom_adjustments: [{ amount: '-10.0' }, { amount: '-5.0' }],
  });
  assert.deepEqual(a, { salesTax: '7.88', shippingTax: '2.68', shipping: '25.55', discounts: '-15.00' });
});

test('fills tax, shipping and extra columns from real BrightSites field names', async () => {
  orderData = {
    grand_total: '136.11',
    customer_email: 'a@b.com',
    shipment: { cost: '25.55', in_hands_date: '2018-06-15' },
    required_adjustments: [{ note: 'sales tax', amount: '7.88' }],
    payment: { state: 'completed', details: { method: 'credit card' } },
  };
  lineItems = [{ id: 1, quantity: 2, tax_price: '3.75', product_id: 10, logos: [{ charge: '10.0' }, { charge: null }] }];
  const { rows } = await buildReportRows({ orders: [{ id: 3 }], storeOpts: {} });
  const col = (name) => rows[0][ALL_COLUMNS.indexOf(name)];
  assert.equal(col('Tax Total'), '3.75');
  assert.equal(col('Store Shipping Cost'), '25.55');
  assert.equal(col('Order Sales Tax'), '7.88');
  assert.equal(col('Payment Method'), 'credit card');
  assert.equal(col('Logo Charges'), '10.00');
  assert.equal(col('In-Hands Date'), '2018-06-15');
});

test('key/value extraction for personalization and options', () => {
  const { extractPersonalizationPairs, extractOptionPairs } = require('../utils/formatters');
  assert.deepStrictEqual(extractPersonalizationPairs([{
    title: 'Establishment Name',
    attributes: [{ key: 'Establishment Name', value: 'Pan Pacific London' }],
    price_modifier: { modifier_type: '$', amount: '0.0' },
  }]), [['Product Personalization: Establishment Name', 'Pan Pacific London'], ['Product Personalization: Establishment Name Price', '$0.0']]);
  assert.deepStrictEqual(extractOptionPairs([{ option_name: 'Award Level', sub_option_name: '5 Star' }]), [['Product Option: Award Level', '5 Star']]);
});

test('keeps raw Version text and supplies its four confirmed split fields', async () => {
  orderData = {};
  lineItems = [{
    id: 46199084,
    product_options: [{
      option_name: 'Version',
      sub_option_name: 'Plaque, 4 Star, 2026, Hotel',
      option_type: 'general',
      option_id: 15510657,
      sub_option_id: 39213314,
    }],
  }];
  const { rows, rowDetails } = await buildReportRows({ orders: [{ order_id: 2505 }], storeOpts: {} });
  assert.equal(rows[0][ALL_COLUMNS.indexOf('Product Options')], 'Version: Plaque, 4 Star, 2026, Hotel');
  assert.deepEqual(rowDetails[0].options, [
    ['Product Option: Product Type', 'Plaque'], ['Product Option: Award Level', '4 Star'],
    ['Product Option: Year', '2026'], ['Product Option: Category', 'Hotel'],
  ]);
});

test('takes dynamic split keys from structured options rather than summary text', async () => {
  orderData = {};
  lineItems = [{
    id: 7,
    options_text: 'Plaque, Matte',
    product_options: [
      { option_name: 'Product Type', sub_option_name: 'Plaque' },
      { option_name: 'Finish', sub_option_name: 'Matte' },
    ],
  }, {
    id: 8,
    product_options: [],
    options: [{ key: 'New Option', value: 'New Value' }],
  }, {
    id: 9,
    product_options: [],
    options_text: 'Finish: Glossy; Warranty: Extended',
  }];
  const { rowDetails } = await buildReportRows({ orders: [{ id: 1 }], storeOpts: {} });
  assert.deepEqual(rowDetails.map((d) => d.options), [
    [['Product Option: Product Type', 'Plaque'], ['Product Option: Finish', 'Matte']],
    [['Product Option: New Option', 'New Value']],
    [['Product Option: Finish', 'Glossy'], ['Product Option: Warranty', 'Extended']],
  ]);
});
