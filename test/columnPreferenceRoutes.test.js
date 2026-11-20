const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPreferenceRoutes } = require('../routes/preferenceRoutes');
const { createColumnPreferenceService, validateLayout } = require('../services/columnPreferenceService');
const { start, request } = require('./helpers/http');

const layout = { deselectedColumns: ['SKU'], columnOrder: ['Placed', 'Order #', 'SKU'], splitPairs: true };
const settings = { url: 'https://project.supabase.co', key: 'sb_secret_test' };

test('layout validation rejects invalid columns, duplicates, unknown settings and report levels', () => {
  assert.deepEqual(validateLayout('shipment', layout), layout);
  assert.deepEqual(validateLayout('order', { ...layout, deselectedColumns: [] }), { ...layout, deselectedColumns: [] });
  for (const value of [null, [], {}, { ...layout, email: 'other@centricitynow.com' },
    { ...layout, splitPairs: 'true' }, { ...layout, columnOrder: ['Unknown'] },
    { ...layout, columnOrder: ['SKU', 'SKU'] }, { ...layout, deselectedColumns: ['UPS Status', 'UPS Status'] }]) {
    assert.throws(() => validateLayout('shipment', value), { statusCode: 400 });
  }
  assert.throws(() => validateLayout('both', layout), { statusCode: 400 });
});

test('storage filters by authenticated email, persists per-level records, and loads after a new service instance', async () => {
  const records = new Map(), calls = [];
  const fetchImpl = async (target, options) => {
    const url = new URL(target);
    calls.push({ url, options });
    if (options.method === 'POST') {
      const row = JSON.parse(options.body);
      records.set(`${row.email}/${row.report_level}`, row);
      return { ok: true };
    }
    const email = url.searchParams.get('email').slice(3);
    return { ok: true, json: async () => [...records.values()].filter(row => row.email === email) };
  };
  const first = createColumnPreferenceService({ ...settings, fetchImpl });
  await first.save('one@centricitynow.com', 'shipment', layout);
  await first.save('one@centricitynow.com', 'order', { ...layout, splitPairs: false });
  await first.save('two@centricitynow.com', 'shipment', { ...layout, columnOrder: ['SKU'] });
  const restarted = createColumnPreferenceService({ ...settings, fetchImpl });
  assert.deepEqual(await restarted.load('one@centricitynow.com'), {
    shipment: layout, order: { ...layout, splitPairs: false },
  });
  assert.deepEqual((await restarted.load('two@centricitynow.com')).shipment.columnOrder, ['SKU']);
  assert.deepEqual(await restarted.load('new@centricitynow.com'), {});
  assert.equal(calls[0].options.headers.apikey, settings.key);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].url.searchParams.get('on_conflict'), 'email,report_level');
});

test('account API takes identity only from the verified session and rejects forged ownership fields', async () => {
  const app = express(), saves = [];
  app.use(express.json());
  app.use((req, res, next) => { req.auth = { email: 'one@centricitynow.com' }; next(); });
  const service = {
    async load(email) { assert.equal(email, 'one@centricitynow.com'); return { shipment: layout }; },
    async save(email, level, value) { validateLayout(level, value); saves.push({ email, level, value }); },
  };
  app.use('/api', createPreferenceRoutes(service));
  const server = await start(app);
  try {
    const loaded = await request(server, '/api/preferences/columns');
    assert.equal(JSON.parse(loaded.body).account, true);
    const saved = await request(server, '/api/preferences/columns/shipment', { method: 'PUT', body: layout });
    assert.equal(saved.status, 200);
    assert.equal(saves[0].email, 'one@centricitynow.com');
    assert.equal((await request(server, '/api/preferences/columns/shipment', { method: 'PUT',
      body: { ...layout, email: 'two@centricitynow.com' } })).status, 400);
    assert.equal(saves.length, 1);
  } finally { server.close(); }
});

test('legacy/no-account mode cannot write account defaults and storage outages are explicit', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createPreferenceRoutes({ async load() { throw new Error('Must not run'); } }));
  const server = await start(app);
  try {
    assert.deepEqual(JSON.parse((await request(server, '/api/preferences/columns')).body), { account: false });
    assert.equal((await request(server, '/api/preferences/columns/order', { method: 'PUT', body: layout })).status, 403);
  } finally { server.close(); }
  const unavailable = createColumnPreferenceService({});
  await assert.rejects(unavailable.load('one@centricitynow.com'), { statusCode: 503 });
  const failed = createColumnPreferenceService({ ...settings, fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(failed.save('one@centricitynow.com', 'shipment', layout), { statusCode: 503 });
  const malformed = createColumnPreferenceService({ ...settings, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(malformed.load('one@centricitynow.com'), /Invalid stored/);
});
