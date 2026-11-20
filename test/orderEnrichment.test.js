const test = require('node:test');
const assert = require('node:assert/strict');
const sites = require('../lib/brightSites');
const orderCache = require('../services/orderCache');
const { loadEnrichedOrder } = require('../services/orderEnrichment');

let calls;
function stub(full) {
  calls = { order: 0, items: 0, shipments: 0 };
  sites.loadOrder = async () => { calls.order++; return full; };
  sites.loadLineItems = async () => { calls.items++; return [{ id: 'separate' }]; };
  sites.loadShipments = async () => { calls.shipments++; return []; };
}

test('embedded line items and shipments need only one request per order', async () => {
  orderCache.configure({ enabled: false });
  stub({ order_id: 7, line_items: [{ id: 1 }], shipments: [{ id: 9, line_items: [{ id: 1, quantity: 1 }] }] });
  const entry = await loadEnrichedOrder({ order_id: 7 }, { subdomain: 'shop' });
  assert.deepEqual(calls, { order: 1, items: 0, shipments: 0 });
  assert.deepEqual(entry.line_items, [{ id: 1 }]);
  assert.equal(entry.shipments.length, 1);
});

test('missing embedded lists fall back to the separate endpoints', async () => {
  orderCache.configure({ enabled: false });
  stub({ order_id: 7 });
  const entry = await loadEnrichedOrder({ order_id: 7 }, { subdomain: 'shop' });
  assert.deepEqual(calls, { order: 1, items: 1, shipments: 1 });
  assert.deepEqual(entry.line_items, [{ id: 'separate' }]);
});

test('the cache reuses unchanged orders and refetches when updated_at changes', async () => {
  orderCache.clear();
  orderCache.configure({ enabled: true });
  try {
    stub({ order_id: 7, line_items: [], shipments: [] });
    const listed = { order_id: 7, updated_at: '2026-11-06T18:37:59Z', status: 'new' };
    await loadEnrichedOrder(listed, { subdomain: 'shop' });
    const again = await loadEnrichedOrder({ ...listed, status: 'shipped' }, { subdomain: 'shop' });
    assert.equal(calls.order, 1, 'unchanged order served from cache');
    assert.equal(again.order.status, 'shipped', 'fresh list fields still win');
    await loadEnrichedOrder(listed, { subdomain: 'other-store' });
    assert.equal(calls.order, 2, 'cache is scoped per store');
    await loadEnrichedOrder({ ...listed, updated_at: '2026-11-13T14:38:14Z' }, { subdomain: 'shop' });
    assert.equal(calls.order, 3, 'changed order refetched');
    await loadEnrichedOrder({ order_id: 8 }, { subdomain: 'shop' });
    await loadEnrichedOrder({ order_id: 8 }, { subdomain: 'shop' });
    assert.equal(calls.order, 5, 'orders without updated_at are never cached');
    assert.equal(orderCache.getStats().hits, 1);
  } finally {
    orderCache.configure({ enabled: false });
    orderCache.clear();
  }
});

test('the cache evicts least recently used orders beyond its size limit', () => {
  orderCache.clear();
  orderCache.configure({ enabled: true, maxEntries: 2 });
  try {
    orderCache.set('s', 1, 'a', { n: 1 });
    orderCache.set('s', 2, 'a', { n: 2 });
    orderCache.get('s', 1, 'a');
    orderCache.set('s', 3, 'a', { n: 3 });
    assert.deepEqual(orderCache.get('s', 1, 'a'), { n: 1 });
    assert.equal(orderCache.get('s', 2, 'a'), null);
  } finally {
    orderCache.configure({ enabled: false, maxEntries: 5000 });
    orderCache.clear();
  }
});
