const test = require('node:test');
const assert = require('node:assert');

process.env.UPS_CLIENT_ID = 'id';
process.env.UPS_CLIENT_SECRET = 'secret';
const ups = require('../lib/ups');

function fakeFetch(calls) {
  return async (url) => {
    calls.push(url);
    if (url.includes('oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (url.includes('1ZBAD')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ trackResponse: { shipment: [{ package: [{
      currentStatus: { description: 'Delivered' }, service: { description: 'UPS Ground' },
      weight: { weight: '2.0', unitOfMeasurement: 'LBS' }, deliveryDate: [{ type: 'DEL', date: '20260105' }],
    }] }] } }) };
  };
}

test('matches UPS tracking numbers and appends columns, one lookup per unique number', async () => {
  ups.resetForTests();
  const calls = [];
  const good = '1Z999AA10123456784';
  const rows = [['a', good], ['b', good], ['c', '9400111899223'], ['d', '']];
  const info = await ups.enrichRowsWithUps(rows, 1, { fetchImpl: fakeFetch(calls) });
  assert.strictEqual(info.lookedUp, 1);
  assert.deepStrictEqual(rows[0].slice(2), ['Delivered', 'UPS Ground', '2.0 lbs', '01/05/2026']);
  assert.deepStrictEqual(rows[2].slice(2), ['', '', '', '']);
  assert.strictEqual(calls.filter((u) => u.includes('/track/')).length, 1);
});

test('failed lookups do not break the report', async () => {
  ups.resetForTests();
  const rows = [['a', '1ZBAD0000000000000']];
  const orig = console.warn; console.warn = () => {};
  const fs = require('fs'); const af = fs.appendFileSync; fs.appendFileSync = () => {};
  try {
    await ups.enrichRowsWithUps(rows, 1, { fetchImpl: fakeFetch([]) });
  } finally { console.warn = orig; fs.appendFileSync = af; }
  assert.strictEqual(rows[0][2], 'Not found');
});
