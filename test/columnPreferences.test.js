const test = require('node:test');
const assert = require('node:assert/strict');
const { orderedColumns, createPreferenceSync } = require('../public/columnPreferences');
const { buildTableView, getTableViewColumns } = require('../public/reportView');
const layout = order => ({ deselectedColumns: [], columnOrder: order, splitPairs: false });

test('ordering retains new columns, drops stale names and keeps headers aligned with cells', () => {
  assert.deepEqual(orderedColumns(['Order #', 'SKU', 'New'], ['SKU', 'old', 'SKU']), ['SKU', 'Order #', 'New']);
  const table = { columns: ['Order #', 'SKU', 'New'], rows: [['1', 'abc', 'n']], rowKeys: ['shop:1'] };
  const options = { columnOrder: ['SKU', 'Order #'], deselectedColumns: ['New'] };
  assert.deepEqual(buildTableView(table, options), { columns: ['SKU', 'Order #'], rows: [['abc', '1']], rowKeys: ['shop:1'] });
  assert.deepEqual(getTableViewColumns(table, options), ['SKU', 'Order #']);
});

test('split columns follow their ordered parent and can still be hidden via that parent', () => {
  const table = { columns: ['Order #', 'Product Options', 'SKU'], rows: [['1', 'Finish: Matte', 'abc']],
    rowDetails: [{ options: [['Product Option: Finish', 'Matte']] }] };
  const options = { splitPairs: true, columnOrder: ['Product Options', 'SKU', 'Order #'] };
  const defaultView = buildTableView(table, { splitPairs: true });
  assert.deepEqual(defaultView.columns, ['Order #', 'Product Option: Finish', 'SKU']);
  assert.deepEqual(defaultView.rows, [['1', 'Matte', 'abc']]);
  assert.deepEqual(defaultView, buildTableView(table, { splitPairs: true, columnOrder: table.columns }));
  assert.deepEqual(buildTableView(table, options).columns, ['Product Option: Finish', 'SKU', 'Order #']);
  assert.deepEqual(buildTableView(table, options).rows, [['Matte', 'abc', '1']]);
  assert.deepEqual(buildTableView(table, { ...options, deselectedColumns: ['Product Options'] }).columns, ['SKU', 'Order #']);
});

test('auto-save serializes writes, coalesces rapid changes, and keeps table layouts separate', async () => {
  const calls = [], statuses = [], releases = [];
  const sync = createPreferenceSync({ fetch: (url, opts) => new Promise(resolve => {
    calls.push({ url, body: JSON.parse(opts.body) });
    releases.push(resolve);
  }), onStatus: status => statuses.push(status) });
  const saving = sync.save('shipment', layout(['Order #']));
  sync.save('shipment', layout(['SKU']));
  sync.save('shipment', layout(['SKU', 'Order #']));
  sync.save('order', layout(['Placed']));
  assert.equal(calls.length, 1);
  releases.shift()({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.columnOrder, ['SKU', 'Order #']);
  releases.shift()({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[2].url, '/api/preferences/columns/order');
  releases.shift()({ ok: true });
  await saving;
  assert.equal(sync.hasPending(), false);
  assert.deepEqual(statuses, ['saving', 'saved']);
});

test('failed saves remain pending, report errors, and retry the latest edits', async () => {
  let success = false;
  const calls = [], statuses = [];
  const sync = createPreferenceSync({ fetch: async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    if (!success) throw new Error('Connection lost');
    return { ok: true };
  }, onStatus: (status, message) => statuses.push({ status, message }) });
  await sync.save('shipment', layout(['Order #']));
  assert.equal(sync.hasPending(), true);
  assert.equal(statuses.at(-1).status, 'error');
  await sync.save('shipment', layout(['SKU']));
  assert.equal(calls.length, 1);
  success = true;
  await sync.retry();
  assert.deepEqual(calls[1].columnOrder, ['SKU']);
  assert.equal(sync.hasPending(), false);
  assert.equal(statuses.at(-1).status, 'saved');
});

test('HTTP failures never appear as saved', async () => {
  const statuses = [];
  const sync = createPreferenceSync({ fetch: async () => ({ ok: false }), onStatus: status => statuses.push(status) });
  await sync.save('order', layout([]));
  assert.deepEqual(statuses, ['saving', 'error']);
  assert.equal(sync.hasPending(), true);
});
