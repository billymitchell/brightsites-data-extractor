const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./helpers/reportFixture');
const sites = require('../lib/brightSites');
let calls;
let failure = false;
sites.loadOrder = async (id, opts) => { calls.order++; if (failure && opts.failOnError) throw new Error('Source unavailable'); return fixture.order; };
sites.loadLineItems = async () => { calls.items++; return fixture.line_items; };
sites.loadShipments = async () => { calls.shipments++; return fixture.shipments; };
const { buildReportTables, buildReportRows } = require('../services/reportRowBuilder');
const opts = { orders: [fixture.order], storeOpts: { subdomain: 'shop' } };
test('both levels use one enrichment and aligned keys', async () => {
  calls = { order: 0, items: 0, shipments: 0 };
  const result = await buildReportTables({ ...opts, reportLevel: 'both' });
  assert.deepEqual(calls, { order: 1, items: 1, shipments: 1 });
  assert.equal(result.tables.order.rows.length, 1);
  assert.equal(result.tables.shipment.rows.length, 3);
  assert.deepEqual(result.tables.order.rowKeys, ['shop:100']);
  assert.deepEqual(result.tables.shipment.rowKeys, ['shop:100', 'shop:100', 'shop:100']);
  for (const table of Object.values(result.tables)) assert.equal(table.rows.length, table.rowDetails.length);
  const legacy = await buildReportRows(opts);
  assert.deepEqual(legacy.rows, result.tables.shipment.rows);
});
test('paired limits, cancellation and enrichment failures reject incomplete results', async () => {
  calls = { order: 0, items: 0, shipments: 0 };
  await assert.rejects(buildReportTables({ ...opts, reportLevel: 'both', maxRows: 3 }), /maximum of 3/);
  await assert.rejects(buildReportTables({ ...opts, reportLevel: 'both', isCanceled: () => true }), /canceled/i);
  failure = true;
  try { await assert.rejects(buildReportTables({ ...opts, reportLevel: 'both' }), /Source unavailable/); } finally { failure = false; }
});
test('empty paired results retain both column schemas', async () => {
  const { tables } = await buildReportTables({ ...opts, orders: [], reportLevel: 'both' });
  assert.equal(tables.order.rows.length, 0);
  assert.equal(tables.shipment.rows.length, 0);
  assert.ok(tables.order.columns.includes('Unique Item Count'));
  assert.ok(tables.shipment.columns.includes('Line Item ID'));
});
