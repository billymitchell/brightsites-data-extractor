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

test('store programs group stores and the client list never carries tokens', () => {
  const { storeProgram, listStoresForClient } = require('../config/stores');
  assert.deepEqual(storeProgram({ program: 'ftg' }), { id: 'ftg', label: 'FTG' });
  assert.deepEqual(storeProgram({ program: 'Ryder' }), { id: 'ryder', label: 'Ryder' });
  assert.deepEqual(storeProgram({ program: 'acme', programLabel: 'Acme Corp' }), { id: 'acme', label: 'Acme Corp' });
  assert.deepEqual(storeProgram({}), { id: '', label: 'Other stores' });

  const list = listStoresForClient({
    'ryder-scs': { subdomain: 'ryderscs', label: 'Ryder SCS', program: 'ryder', token: 'secret-token-1' },
    'secret-token-2': { subdomain: 'legacy', label: 'Legacy', token: 'secret-token-2' },
  });
  assert.deepEqual(list[0], { key: 'ryder-scs', label: 'Ryder SCS', subdomain: 'ryderscs', program: 'ryder', programLabel: 'Ryder' });
  assert.ok(!JSON.stringify(list).includes('secret-token-1'));
  assert.equal(list[1].program, '');
});
