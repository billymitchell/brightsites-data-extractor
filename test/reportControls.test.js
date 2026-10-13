const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function harness() {
  const elements = new Map();
  const requests = [];
  const saved = new Map();
  class Element {
    constructor() { this.value = ''; this.checked = false; this.children = []; this.events = {}; this.dataset = {}; this.hidden = false; }
    addEventListener(type, fn) { this.events[type] = fn; }
    appendChild(el) { this.children.push(el); return el; }
    setAttribute() {}
    remove() {}
  }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element(), createTextNode: s => ({textContent:s}), querySelectorAll: () => [], body: new Element() };
  document.getElementById('reportLevel').value = 'shipment';
  const fetch = async (url, opts) => {
    requests.push({ url, opts });
    const json = url.startsWith('/api/columns') ? { core: ['Order #'], groups: [{ label: 'Order', columns: ['Order #'] }] } : [];
    return { ok: true, status: 200, json: async () => json };
  };
  const context = vm.createContext({ document, window: { fetch, addEventListener() {} }, fetch,
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,v) },
    console, setTimeout, clearTimeout, URL, Blob,
    BrightSitesCsv: require('../public/csv'),
    BrightSitesReportView: (() => { try { return require('../public/reportView'); } catch { return {}; } })(),
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
  assert.equal(document.getElementById('includeUps').disabled, false);
  assert.equal(document.getElementById('download').disabled, true);
  assert.equal(document.getElementById('download').textContent, 'Download Excel');
  assert.equal(vm.runInContext('fullResult', context), null);
  mode.value = 'order'; await mode.events.change();
  assert.equal(document.getElementById('includeUps').disabled, true);
  vm.runInContext("activeJobId = 'job'; setJobControlState();", context);
  assert.equal(mode.disabled, true);
});
test('preview tab switching reuses completed tables and retains independent preferences', async () => {
  const { document, requests, context } = harness();
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
