const test = require('node:test');
const assert = require('node:assert/strict');
const { makeOrderKey, deduplicateOrders } = require('../services/reportFields');
test('canonical keys are stable, nonsecret and scoped to the store', () => {
  assert.equal(makeOrderKey('shop', { id: '000123', order_id: 7 }), 'shop:000123');
  assert.notEqual(makeOrderKey('shop', { id: 1 }), makeOrderKey('other', { id: 1 }));
  assert.throws(() => makeOrderKey('shop', {}), /identifier/);
});
test('order sources deduplicate canonical IDs without collapsing different orders', () => {
  assert.deepEqual(deduplicateOrders([{ id: 1 }, { id: 1 }, { id: 2 }]), [{ id: 1 }, { id: 2 }]);
  assert.throws(() => deduplicateOrders([{}]), /identifier/);
});
