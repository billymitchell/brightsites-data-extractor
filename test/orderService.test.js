const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRIGHTSITES_STORES = JSON.stringify({
  test: { subdomain: 'example', token: 'test-token' },
});

const { validateRunRequest } = require('../services/orderService');

test('multi-status order reports preserve canonical IDs and reject missing IDs', async () => {
  const sites = require('../lib/brightSites');
  const originalFetch = sites.fetchAllPages;
  const servicePath = require.resolve('../services/orderService');
  try {
    let missingId = false;
    sites.fetchAllPages = async (path, params) => params.status === 'one'
      ? [{ id: 'api-1', order_id: '100' }, ...(missingId ? [{}] : [])]
      : [{ id: 'api-2', order_id: '100' }, { id: 'api-1', order_id: '100' }];
    delete require.cache[servicePath];
    const { getRunContext } = require(servicePath);
    for (const reportLevel of ['order', 'both']) {
      const body = { storeKey: 'test', start: '2026-02-01', end: '2026-02-02', reportLevel, status: ['one', 'two'] };
      const context = await getRunContext(body);
      assert.deepEqual(context.orders.map(order => order.id), ['api-1', 'api-2']);
      missingId = true;
      await assert.rejects(getRunContext(body), /missing.*identifier|no.*identifier/i);
      missingId = false;
    }
  } finally {
    sites.fetchAllPages = originalFetch;
    delete require.cache[servicePath];
  }
});

test('rejects reversed report date ranges', () => {
  assert.throws(
    () => validateRunRequest({ storeKey: 'test', start: '2026-02-02', end: '2026-02-01' }),
    { statusCode: 400, message: 'End date must be on or after the start date.' }
  );
});

test('rejects impossible calendar dates', () => {
  assert.throws(
    () => validateRunRequest({ storeKey: 'test', start: '2026-02-30', end: '2026-03-01' }),
    { statusCode: 400, message: 'Start and end must be valid dates.' }
  );
});

test('accepts a valid report date range', () => {
  const context = validateRunRequest({ storeKey: 'test', start: '2026-02-01', end: '2026-02-02' });
  assert.equal(context.storeKey, 'test');
  assert.equal(context.params.created_at_from, '2026-02-01T00:00:00.000Z');
  assert.equal(context.params.created_at_to, '2026-02-02T23:59:59.999Z');
});

test('validates report level and allows UPS only when shipment rows are requested', () => {
  const base = { storeKey: 'test', start: '2026-02-01', end: '2026-02-02' };
  assert.equal(validateRunRequest(base).reportLevel, 'shipment');
  assert.equal(validateRunRequest({ ...base, reportLevel: 'both', includeUps: true }).reportLevel, 'both');
  assert.equal(validateRunRequest({ ...base, reportLevel: 'order' }).reportLevel, 'order');
  assert.throws(() => validateRunRequest({ ...base, reportLevel: 'order', includeUps: true }), { statusCode: 400 });
  assert.throws(() => validateRunRequest({ ...base, reportLevel: 'unknown' }), { statusCode: 400 });
});
