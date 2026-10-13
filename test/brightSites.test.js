const test = require('node:test');
const assert = require('node:assert/strict');
process.env.BRIGHTSITES_RATE_LIMIT_PER_MINUTE = '1000000';
let status = 200;
let payload = { line_items: [] };
const fetchPath = require.resolve('node-fetch');
require(fetchPath);
require.cache[fetchPath].exports = async () => ({ ok: status === 200, status, statusText: 'Test', headers: { get: () => null }, text: async () => 'Fixture failure', json: async () => payload });
const logger = require('../utils/logger');
logger.logError = () => {};
const sites = require('../lib/brightSites');
const opts = { subdomain: 'example', token: 'test-token' };
test('successful empty enrichment differs from failed strict enrichment', async () => {
  assert.deepEqual(await sites.loadLineItems(1, { ...opts, failOnError: true }), []);
  status = 401;
  for (const load of [sites.loadOrder, sites.loadLineItems, sites.loadShipments]) {
    await assert.rejects(load(1, { ...opts, failOnError: true }), /HTTP 401/);
  }
  assert.deepEqual(await sites.loadLineItems(1, opts), []);
  assert.deepEqual(await sites.loadOrder(1, opts), {});
});
