const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function harness(preferences = { account: false }) {
  const elements = new Map();
  const requests = [];
  const saved = new Map();
  class Element {
    constructor() { this.value = ''; this.checked = false; this.children = []; this.events = {}; this.dataset = {}; this.hidden = false; }
    addEventListener(type, fn) { this.events[type] = fn; }
    appendChild(el) { this.children.push(el); return el; }
    setAttribute() {}
    querySelectorAll() { return []; }
    remove() {}
  }
  const document = {
    getElementById(id) {
      if (['includeUps', 'upsHelp'].includes(id)) throw new Error(`Removed UPS control accessed: ${id}`);
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(), createTextNode: s => ({textContent:s}), querySelectorAll: () => [], body: new Element(),
  };
  document.getElementById('reportLevel').value = 'shipment';
  const fetch = async (url, opts) => {
    requests.push({ url, opts });
    const json = url === '/api/preferences/columns' ? preferences
      : url.startsWith('/api/columns') ? { core: ['Order #'], groups: [{ label: 'Order', columns: ['Order #', 'SKU'] }] } : [];
    return { ok: true, status: 200, json: async () => json };
  };
  const context = vm.createContext({ document, window: { fetch, addEventListener() {} }, fetch,
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,v) },
    console, setTimeout, clearTimeout, URL, Blob,
    BrightSitesCsv: require('../public/csv'),
    BrightSitesReportView: (() => { try { return require('../public/reportView'); } catch { return {}; } })(),
    BrightSitesColumnPreferences: require('../public/columnPreferences'),
  });
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);
  return { document, requests, saved, context };
}
test('table-type controls enforce supported formats and clear stale results', async () => {
  const { document, context } = harness();
  const mode = document.getElementById('reportLevel');
  assert.equal(typeof mode.events.change, 'function');
  vm.runInContext("fullResult = { columns: [], rows: [], meta: { reportLevel: 'shipment' } };", context);
  mode.value = 'both';
  await mode.events.change();
  assert.equal(document.getElementById('danielleFormat').disabled, true);
  assert.equal(document.getElementById('download').disabled, true);
  assert.equal(document.getElementById('download').textContent, 'Download Excel');
  assert.equal(vm.runInContext('fullResult', context), null);
  mode.value = 'order'; await mode.events.change();
  vm.runInContext("activeJobId = 'job'; setJobControlState();", context);
  assert.equal(mode.disabled, true);
});
test('UPS enrichment no longer has an opt-in control or request flag', async () => {
  assert.doesNotMatch(html, /id="includeUps"|id="upsHelp"|Add UPS tracking data/);
  const { document, requests, context } = harness();
  await vm.runInContext("activateTable('shipment')", context);
  document.getElementById('storeSelect').value = 'test';
  document.getElementById('start').value = '2026-02-01';
  document.getElementById('end').value = '2026-02-02';
  await document.getElementById('run').events.click();
  const request = requests.find(r => r.url === '/api/run');
  assert.ok(request);
  assert.equal(Object.hasOwn(JSON.parse(request.opts.body), 'includeUps'), false);
});
test('preview tab switching reuses completed tables and retains independent preferences', async () => {
  const { document, requests, context } = harness();
  await vm.runInContext('preferencesReady', context);
  const result = { tables: { order: { columns: ['Order #'], rows: [['1']], rowKeys: ['shop:1'] }, shipment: { columns: ['Order #'], rows: [['1'], ['1']], rowKeys: ['shop:1','shop:1'] } }, meta: { reportLevel: 'both' } };
  context.fixture = result;
  vm.runInContext("fullResult = fixture; activeTableLevel = 'order';", context);
  const mode = document.getElementById('reportLevel'); mode.value = 'both';
  await document.getElementById('previewShipments').events.click();
  assert.equal(vm.runInContext('activeTableLevel', context), 'shipment');
  assert.equal(vm.runInContext('fullResult.tables.order.rows.length', context), 1);
  assert.ok(!requests.some(r => r.url.startsWith('/api/run')));
  vm.runInContext("deselectedColumns.add('Order #'); saveColumnSelection();", context);
  await document.getElementById('previewOrders').events.click();
  assert.equal(vm.runInContext("deselectedColumns.has('Order #')", context), false);
  await document.getElementById('previewShipments').events.click();
  assert.equal(vm.runInContext("deselectedColumns.has('Order #')", context), true);
});

test('column actions cannot overwrite another table while its catalog is loading', async () => {
  const { document, context } = harness();
  await vm.runInContext('preferencesReady', context);
  await vm.runInContext('loadColumnPicker()', context);
  vm.runInContext("hiddenByLevel.order.add('Order Only');", context);
  let release;
  context.fetch = async () => new Promise(resolve => { release = resolve; });
  const switching = vm.runInContext("activateTable('order')", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('colsNone').disabled, true);
  document.getElementById('colsNone').events.click();
  assert.deepEqual(Array.from(vm.runInContext('[...hiddenByLevel.order]', context)), ['Order Only']);
  release({ ok: true, json: async () => ({ core: ['Order Only'], groups: [{ label: 'Order', columns: ['Order Only'] }] }) });
  await switching;
  assert.equal(document.getElementById('colsNone').disabled, false);
});

test('account layouts load without writing defaults and never reuse browser column state', async () => {
  const { document, requests, saved, context } = harness({ account: true, layouts: {
    shipment: { deselectedColumns: ['SKU'], columnOrder: ['SKU', 'Order #'], splitPairs: true },
    order: { deselectedColumns: [], columnOrder: ['Order #'], splitPairs: false },
  } });
  saved.set('brightsites_deselected_columns_v2', JSON.stringify(['Order #']));
  await vm.runInContext("activateTable('shipment')", context);
  assert.deepEqual(Array.from(vm.runInContext('[...deselectedColumns]', context)), ['SKU']);
  assert.equal(document.getElementById('splitPairs').checked, true);
  assert.equal(requests.filter(r => r.opts && r.opts.method === 'PUT').length, 0);
  vm.runInContext("deselectedColumns.delete('SKU'); saveColumnSelection();", context);
  const save = requests.find(r => r.opts && r.opts.method === 'PUT');
  assert.equal(save.url, '/api/preferences/columns/shipment');
  assert.deepEqual(JSON.parse(save.opts.body), { deselectedColumns: [], columnOrder: ['SKU', 'Order #'], splitPairs: true });
  assert.equal(saved.get('brightsites_deselected_columns_v2'), '["Order #"]');
});

test('reordering selected columns saves their order and affects the preview data', async () => {
  const { document, requests, context } = harness({ account: true, layouts: {} });
  await vm.runInContext("activateTable('shipment')", context);
  const orderHost = document.getElementById('columnOrder');
  orderHost.children = [];
  vm.runInContext('renderColumnOrder()', context);
  const down = orderHost.children[0].children[2];
  down.events.click();
  assert.deepEqual(Array.from(vm.runInContext('orderByLevel.shipment', context)), ['SKU', 'Order #']);
  assert.deepEqual(JSON.parse(requests.find(r => r.opts && r.opts.method === 'PUT').opts.body).columnOrder, ['SKU', 'Order #']);
  context.fixture = { columns: ['Order #', 'SKU'], rows: [['1', 'sku-1']] };
  const view = JSON.parse(JSON.stringify(vm.runInContext('buildViewData(fixture)', context)));
  assert.deepEqual(view.columns, ['SKU', 'Order #']);
  assert.deepEqual(view.rows, [['sku-1', '1']]);
});

test('failed account loads disable editing until retry succeeds', async () => {
  const { document, context } = harness();
  await vm.runInContext('preferencesReady', context);
  context.fetch = async () => ({ ok: false });
  vm.runInContext('preferencesLoaded = false;', context);
  await vm.runInContext('loadAccountPreferences()', context);
  await vm.runInContext('loadColumnPicker()', context);
  assert.equal(document.getElementById('colsAll').disabled, true);
  assert.equal(document.getElementById('splitPairs').disabled, true);
  assert.match(document.getElementById('preferenceStatus').textContent, /Could not load/);
  assert.equal(document.getElementById('retryPreferences').hidden, false);
  context.fetch = async url => ({ ok: true, json: async () => url === '/api/preferences/columns'
    ? { account: true, layouts: {} } : { core: [], groups: [] } });
  await document.getElementById('retryPreferences').events.click();
  assert.equal(document.getElementById('colsAll').disabled, false);
});

test('retry clears a catalog load error only after the catalog loads successfully', async () => {
  const { document, context } = harness({ account: true, layouts: {} });
  await vm.runInContext('preferencesReady', context);
  context.fetch = async () => ({ ok: false });
  await vm.runInContext('loadColumnPicker()', context);
  await document.getElementById('retryPreferences').events.click();
  assert.equal(document.getElementById('retryPreferences').hidden, false);
  assert.equal(document.getElementById('colsAll').disabled, true);
  context.fetch = async () => ({ ok: true, json: async () => ({ core: [], groups: [] }) });
  await document.getElementById('retryPreferences').events.click();
  assert.equal(document.getElementById('retryPreferences').hidden, true);
  assert.equal(document.getElementById('colsAll').disabled, false);
  assert.match(document.getElementById('preferenceStatus').textContent, /save automatically/);
});
