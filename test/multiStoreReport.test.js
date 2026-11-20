const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRIGHTSITES_STORES = JSON.stringify({
  shop: { subdomain: 'ftg-shop', token: 'shop-token', label: 'FTG Shop' },
  redeem: { subdomain: 'ftg-redemption', token: 'redeem-token', label: 'FTG Redemption' },
  bare: { subdomain: 'bare', token: 'bare-token' },
});

const sites = require('../lib/brightSites');
require('../utils/logger').logInfo = () => {};

// Both stores have an order 100, so a consolidated report must keep them apart.
const listed = {
  'ftg-shop': [{ id: 'a', order_id: '100', updated_at: '2026-02-01T10:00:00Z' }],
  'ftg-redemption': [{ id: 'b', order_id: '100', updated_at: '2026-02-01T11:00:00Z' }, { id: 'c', order_id: '101', updated_at: '2026-02-01T12:00:00Z' }],
  bare: [{ id: 'd', order_id: '7', updated_at: '2026-02-01T12:00:00Z' }],
};
const site = {
  'ftg-shop': { site_name: 'Forbes Travel Guide Product Store', site_url: 'https://ftg-shop.mybrightsites.com' },
  'ftg-redemption': { site_name: 'Forbes Travel Guide Award Redemption Store', site_url: 'https://ftg-redemption.mybrightsites.com' },
  bare: {},
};
const fetched = [];
const loaded = [];
sites.fetchAllPages = async (path, params, perPage, opts) => {
  fetched.push({ subdomain: opts.subdomain, token: opts.token });
  return listed[opts.subdomain].map((o) => ({ ...o }));
};
sites.loadOrder = async (id, opts) => {
  loaded.push(`${opts.subdomain}:${id}:${opts.token}`);
  const order = listed[opts.subdomain].find((o) => o.id === id);
  return {
    ...order, ...site[opts.subdomain], status: 'shipped', created_at: '2026-02-01T15:00:00Z',
    line_items: [{ id: `${opts.subdomain}-${id}-li`, name: 'Item', quantity: 1 }],
    shipments: [],
  };
};

const { validateRunRequest } = require('../services/orderService');
const jobs = require('../services/reportJobService');

async function finished(id) {
  for (let i = 0; i < 1000; i++) {
    const job = jobs.getJob(id);
    if (['completed', 'failed', 'canceled'].includes(job.status)) return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Job did not finish');
}

test('run requests accept several stores and reject unknown ones', () => {
  const base = { start: '2026-02-01', end: '2026-02-02' };
  assert.deepEqual(validateRunRequest({ ...base, storeKeys: ['shop', 'redeem', 'shop'] }).storeKeys, ['shop', 'redeem']);
  assert.deepEqual(validateRunRequest({ ...base, storeKeys: 'shop, redeem' }).storeKeys, ['shop', 'redeem']);
  assert.deepEqual(validateRunRequest({ ...base, storeKey: 'shop' }).storeKeys, ['shop']);
  assert.throws(() => validateRunRequest({ ...base, storeKeys: [] }), { statusCode: 400, message: /at least one store/ });
  assert.throws(() => validateRunRequest({ ...base, storeKeys: ['shop', 'nope'] }), { statusCode: 400, message: /'nope' not found/ });
});

test('a consolidated report fetches each store with its own credentials and labels every row', async () => {
  fetched.length = 0;
  loaded.length = 0;
  const job = jobs.createJob({ storeKeys: ['shop', 'redeem'], start: '2026-02-01', end: '2026-02-02', reportLevel: 'both', includeUps: false });
  assert.deepEqual(job.request.storeKeys, ['shop', 'redeem']);
  const done = await finished(job.id);
  assert.equal(done.status, 'completed', done.error);
  assert.deepEqual(fetched, [{ subdomain: 'ftg-shop', token: 'shop-token' }, { subdomain: 'ftg-redemption', token: 'redeem-token' }]);
  assert.deepEqual(loaded.sort(), ['ftg-redemption:b:redeem-token', 'ftg-redemption:c:redeem-token', 'ftg-shop:a:shop-token']);

  const { tables, meta } = jobs.getJobResult(job.id).result;
  assert.equal(meta.orders, 3);
  assert.deepEqual(meta.stores.map((s) => s.storeKey), ['shop', 'redeem']);
  for (const level of ['order', 'shipment']) {
    const table = tables[level];
    assert.deepEqual(table.columns.slice(0, 2), ['Store Name', 'Store URL']);
    const byOrder = table.rows.map((r) => `${r[0]} | ${r[1]} | ${r[table.columns.indexOf('Order #')]}`).sort();
    assert.deepEqual(byOrder, [
      'Forbes Travel Guide Award Redemption Store | https://ftg-redemption.mybrightsites.com | 100',
      'Forbes Travel Guide Award Redemption Store | https://ftg-redemption.mybrightsites.com | 101',
      'Forbes Travel Guide Product Store | https://ftg-shop.mybrightsites.com | 100',
    ]);
    assert.equal(new Set(table.rowKeys).size, 3, `${level} rows keep store-scoped keys`);
  }
});

test('store columns fall back to the configured store when the API leaves them out', async () => {
  const job = jobs.createJob({ storeKeys: ['bare'], start: '2026-02-01', end: '2026-02-02', reportLevel: 'order' });
  assert.equal((await finished(job.id)).status, 'completed');
  const { rows, columns } = jobs.getJobResult(job.id).result;
  assert.equal(rows[0][columns.indexOf('Store Name')], 'bare');
  assert.equal(rows[0][columns.indexOf('Store URL')], 'https://bare.mybrightsites.com');
});
