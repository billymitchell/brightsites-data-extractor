const test = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredStores } = require('../config/stores');

test('supports legacy single-store environment configuration', () => {
  delete process.env.BRIGHTSITES_STORES;
  process.env.BRIGHTSITES_SUBDOMAIN = 'legacy-shop';
  process.env.BRIGHTSITES_API_TOKEN = 'legacy-token';

  assert.deepEqual(getConfiguredStores(), {
    default: {
      subdomain: 'legacy-shop',
      token: 'legacy-token',
      label: 'legacy-shop',
    },
  });
});
