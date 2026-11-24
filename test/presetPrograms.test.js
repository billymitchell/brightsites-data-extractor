const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRIGHTSITES_STORES = JSON.stringify({
  'ryder-scs': { subdomain: 'ryderscs', label: 'Ryder SCS', program: 'ryder', token: 't1' },
  'ftg-shop': { subdomain: 'ftg-shop', label: 'FTG Shop', program: 'ftg', role: 'product', token: 't2' },
});
const { listPresets, validatePresetRequest } = require('../services/presets');

test('formats are tagged with their program and only use that program\'s stores', () => {
  const presets = listPresets();
  assert.ok(presets.length > 0);
  assert.ok(presets.every(p => p.program === 'ftg' && p.programLabel === 'FTG'));
  const product = presets.find(p => p.id === 'product-store-report');
  assert.equal(product.available, true);
  assert.equal(product.stores[0].storeKey, 'ftg-shop');
  // The Redemption store is missing from FTG; a Ryder store must not stand in for it.
  assert.equal(presets.find(p => p.id === 'redemption-store-report').available, false);
  assert.throws(() => validatePresetRequest({ preset: 'redemption-store-report', start: '2026-01-01', end: '2026-01-31' }), /Redemption Store/);
});

test('formats for a program with no configured stores are not listed', () => {
  process.env.BRIGHTSITES_STORES = JSON.stringify({
    'ryder-scs': { subdomain: 'ryderscs', label: 'Ryder SCS', program: 'ryder', token: 't1' },
  });
  assert.deepEqual(listPresets(), []);
});
