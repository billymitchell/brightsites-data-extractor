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
  assert.deepStrictEqual(rows[0].slice(2, 6), ['Delivered', 'UPS Ground', '2.0 lbs', '01/05/2026']);
  assert.strictEqual(rows[0].length, 2 + ups.UPS_COLUMNS.length);
  assert.deepStrictEqual(rows[2].slice(2), ups.UPS_COLUMNS.map(() => ''));
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

test('parses extra tracking fields from the UPS response shape', () => {
  const r = ups.parseTrackResponse({ trackResponse: { shipment: [{ package: [{
    currentStatus: { description: 'Delivered' },
    activity: [{ date: '20260105', time: '143000' }],
    deliveryDate: [{ type: 'DEL', date: '20260105' }],
    deliveryTime: { type: 'DEL', endTime: '143000' },
    deliveryInformation: { receivedBy: 'J DOE', location: 'Front Door' },
    packageAddress: [
      { type: 'ORIGIN', address: { city: 'Austin', stateProvince: 'TX', countryCode: 'US' } },
      { type: 'DESTINATION', address: { city: 'London', countryCode: 'GB' } },
    ],
    referenceNumber: [{ number: 'PO123' }, { number: 'ORD9' }],
    packageCount: 2, additionalServices: ['SIGNATURE_REQUIRED'],
    dimension: { length: '10', width: '8', height: '4', unitOfDimension: 'IN' },
    alternateTrackingNumber: [{ number: '9400' }],
  }] }] } });
  assert.deepStrictEqual(r.extra, ['01/05/2026 14:30', '01/05/2026', '14:30', 'J DOE', 'Front Door', 'Austin, TX, US', 'London, GB', 'PO123; ORD9', '2', 'SIGNATURE_REQUIRED', '10 x 8 x 4 in', '9400']);
});
