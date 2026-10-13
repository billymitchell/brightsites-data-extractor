const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./helpers/reportFixture');
process.env.BRIGHTSITES_STORES = JSON.stringify({ test: { subdomain: 'shop', token: 'test-token' } });
const sites = require('../lib/brightSites');
sites.fetchAllPages = async () => [fixture.order];
sites.loadOrder = async () => fixture.order;
sites.loadLineItems = async () => fixture.line_items;
sites.loadShipments = async () => fixture.shipments;
require('../utils/logger').logInfo = () => {};
const jobs = require('../services/reportJobService');
const ups = require('../lib/ups');
async function finished(id) {
  for (let i = 0; i < 1000; i++) {
    const job = jobs.getJob(id);
    if (['completed', 'failed', 'canceled'].includes(job.status)) return job;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Fixture job did not complete');
}
test('concurrent jobs publish independent levels, schemas and row counts', async () => {
  const base = { storeKey: 'test', start: '2026-02-01', end: '2026-02-02' };
  const paired = jobs.createJob({ ...base, reportLevel: 'both' });
  const single = jobs.createJob({ ...base, reportLevel: 'order' });
  assert.equal((await finished(paired.id)).status, 'completed');
  assert.equal((await finished(single.id)).status, 'completed');
  const both = jobs.getJobResult(paired.id).result;
  assert.equal(both.meta.reportLevel, 'both');
  assert.deepEqual(both.meta.rowCounts, { order: 1, shipment: 3 });
  const order = jobs.getJobResult(single.id).result;
  assert.equal(order.meta.reportLevel, 'order');
  assert.equal(order.rows.length, 1);
  assert.ok(order.columns.includes('Unique Item Count'));
});
test('UPS enriches only shipment rows of a paired result', async () => {
  const original = { configured: ups.isConfigured, enrich: ups.enrichRowsWithUps };
  ups.isConfigured = () => true;
  ups.enrichRowsWithUps = async rows => { assert.equal(rows.length, 3); rows.forEach(r => r.push(...ups.UPS_COLUMNS.map(() => 'fixture'))); return { lookedUp: 2, failed: 0 }; };
  try {
    const job = jobs.createJob({ storeKey: 'test', start: '2026-02-01', end: '2026-02-02', reportLevel: 'both', includeUps: true });
    assert.equal((await finished(job.id)).status, 'completed');
    const { tables } = jobs.getJobResult(job.id).result;
    assert.ok(tables.shipment.columns.includes('UPS Status'));
    assert.ok(!tables.order.columns.includes('UPS Status'));
    assert.equal(tables.shipment.columns.length, tables.shipment.rows[0].length);
  } finally { ups.isConfigured = original.configured; ups.enrichRowsWithUps = original.enrich; }
});
