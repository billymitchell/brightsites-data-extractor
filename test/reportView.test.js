const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractOptionPairs } = require('../utils/formatters');
const { escapeCsvCell } = require('../public/csv');

// Exercise the same view builder used by the preview and CSV download.
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const start = html.indexOf('        function buildViewData(result) {');
const end = html.indexOf('        downloadButton.addEventListener', start);

function buildView(result, split, deselected = []) {
  const context = vm.createContext({
    document: { getElementById: (id) => ({ checked: id === 'splitPairs' && split }) },
    deselectedColumns: new Set(deselected),
    BrightSitesReportView: require('../public/reportView'),
  });
  vm.runInContext(html.slice(start, end), context);
  return JSON.parse(JSON.stringify(context.buildViewData(result)));
}

function redemptionResult() {
  const values = ['Plaque, 4 Star, 2026, Hotel', 'Plaque, Recommended, 2026, Restaurant'];
  return {
    columns: ['Order #', 'Product Options'],
    rows: values.map((v) => ['2505', `Version: ${v}`]),
    rowDetails: values.map((v) => ({ options: extractOptionPairs([{ option_name: 'Version', sub_option_name: v }]) })),
  };
}

test('preview and CSV discover new keys across rows and share columns for matching keys', () => {
  const options = [
    [{ option_name: 'Finish', sub_option_name: 'Matte' }],
    [{ option_name: 'Finish', sub_option_name: 'Glossy' }, { option_name: 'Warranty', sub_option_name: 'Extended' }],
    [{ option_name: 'Engraving Location', sub_option_name: 'Back' }],
  ];
  const view = buildView({
    columns: ['Order #', 'Product Options'],
    rows: [['1', 'Finish: Matte'], ['2', 'Finish: Glossy; Warranty: Extended'], ['3', 'Engraving Location: Back']],
    rowDetails: options.map((opts) => ({ options: extractOptionPairs(opts) })),
  }, true);
  assert.deepEqual(view.columns, [
    'Order #', 'Product Option: Finish', 'Product Option: Warranty', 'Product Option: Engraving Location',
  ]);
  assert.deepEqual(view.rows, [
    ['1', 'Matte', '', ''],
    ['2', 'Glossy', 'Extended', ''],
    ['3', '', '', 'Back'],
  ]);
  const csv = [view.columns, ...view.rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
  assert.equal(csv,
    'Order #,Product Option: Finish,Product Option: Warranty,Product Option: Engraving Location\n' +
    '1,Matte,,\n2,Glossy,Extended,\n3,,,Back');
});

test('keeps the original Version value when splitting is off', () => {
  const view = buildView(redemptionResult(), false);
  assert.deepEqual(view.columns, ['Order #', 'Product Options']);
  assert.equal(view.rows[0][1], 'Version: Plaque, 4 Star, 2026, Hotel');
});

test('preview and CSV expose Version parts alongside newly named dynamic keys', () => {
  const result = redemptionResult();
  result.rowDetails[1].options.push(['Product Option: New Key', 'New Value']);
  const view = buildView(result, true);
  assert.deepEqual(view.columns, ['Order #', 'Product Option: Product Type', 'Product Option: Award Level', 'Product Option: Year', 'Product Option: Category', 'Product Option: New Key']);
  assert.deepEqual(view.rows, [['2505', 'Plaque', '4 Star', '2026', 'Hotel', ''], ['2505', 'Plaque', 'Recommended', '2026', 'Restaurant', 'New Value']]);
});

test('hiding Product Options also hides the split Version columns', () => {
  const view = buildView(redemptionResult(), true, ['Product Options']);
  assert.deepEqual(view, { rowKeys: [], columns: ['Order #'], rows: [['2505'], ['2505']] });
});
