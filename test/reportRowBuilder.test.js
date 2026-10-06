const test = require('node:test');
const assert = require('node:assert/strict');

const brightSites = require('../lib/brightSites');
let orderData;
let lineItems;
brightSites.loadOrder = async () => orderData;
brightSites.loadLineItems = async () => lineItems;
brightSites.loadShipments = async () => [];

const { COLUMNS, STRUCTURED_COLUMNS } = require('../config/report');
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

  assert.equal(row.length, COLUMNS.length + STRUCTURED_COLUMNS.length);
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
