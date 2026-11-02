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
  const paired = jobs.createJob({ ...base, reportLevel: 'both', includeUps: false });
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
test('UPS enriches shipment and paired reports by default, but not order reports', async () => {
  const original = { configured: ups.isConfigured, enrich: ups.enrichRowsWithUps };
  ups.isConfigured = () => true;
  let lookups = 0;
  ups.enrichRowsWithUps = async rows => { lookups++; assert.equal(rows.length, 3); rows.forEach(r => r.push(...ups.UPS_COLUMNS.map(() => 'fixture'))); return { lookedUp: 2, failed: 0 }; };
  try {
    for (const reportLevel of [undefined, 'both', 'order']) {
      const job = jobs.createJob({ storeKey: 'test', start: '2026-02-01', end: '2026-02-02', reportLevel });
      assert.equal((await finished(job.id)).status, 'completed');
      const result = jobs.getJobResult(job.id).result;
      const shipment = result.tables ? result.tables.shipment : reportLevel !== 'order' ? result : null;
      if (shipment) {
        assert.ok(shipment.columns.includes('UPS Status'));
        assert.equal(shipment.columns.length, shipment.rows[0].length);
        assert.deepEqual(result.meta.ups, { lookedUp: 2, failed: 0 });
      }
      const order = result.tables ? result.tables.order : reportLevel === 'order' ? result : null;
      if (order) assert.ok(!order.columns.includes('UPS Status'));
    }
    assert.equal(lookups, 2);
  } finally { ups.isConfigured = original.configured; ups.enrichRowsWithUps = original.enrich; }
});

test('default UPS enrichment fails explicitly when credentials are missing', async () => {
  const original = ups.isConfigured;
  ups.isConfigured = () => false;
  try {
    const base = { storeKey: 'test', start: '2026-02-01', end: '2026-02-02' };
    const job = jobs.createJob(base);
    const failed = await finished(job.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /UPS_CLIENT_ID \/ UPS_CLIENT_SECRET missing/);
    const optedOut = jobs.createJob({ ...base, includeUps: false });
    assert.equal((await finished(optedOut.id)).status, 'completed');
    assert.ok(!jobs.getJobResult(optedOut.id).result.columns.includes('UPS Status'));
  } finally { ups.isConfigured = original; }
});
