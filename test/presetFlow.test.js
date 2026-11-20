// End to end: HTTP run -> poll -> result -> Excel download, against stubbed BrightSites data.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ExcelJS = require('exceljs');
const fixture = require('./helpers/presetFixture');

process.env.BRIGHTSITES_STORES = JSON.stringify(fixture.STORES);
process.env.REPORT_TIMEZONE = 'America/New_York';
const sites = require('../lib/brightSites');
const calls = fixture.install(sites);
const logger = require('../utils/logger');
logger.logInfo = () => {};
logger.logError = () => {};
logger.logWarn = () => {};
const orderCache = require('../services/orderCache');
const { start, request } = require('./helpers/http');

let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/storeRoutes'));
  app.use('/api', require('../routes/reportRoutes'));
  server = await start(app);
});
test.after(() => server && server.close());

async function runPreset(preset, start = '2026-11-02', end = '2026-11-08') {
  const created = await request(server, '/api/run', { method: 'POST', body: { preset, start, end } });
  assert.equal(created.status, 202, created.body);
  const job = JSON.parse(created.body);
  let status;
  for (let i = 0; i < 2000; i++) {
    status = JSON.parse((await request(server, `/api/run/${job.id}`)).body);
    if (['completed', 'failed', 'canceled'].includes(status.status)) break;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(status.status, 'completed', status.error);
  const result = JSON.parse((await request(server, `/api/run/${job.id}/result`)).body);
  const download = await request(server, `/api/run/${job.id}/preset-workbook`, { method: 'POST' });
  assert.equal(download.status, 200, download.body);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(download.buffer);
  return { job, result, download, workbook };
}

// ExcelJS omits a cached formula result of 0; Excel recalculates on open (fullCalcOnLoad).
const value = cell => (cell.value && typeof cell.value === 'object' && 'formula' in cell.value ? (cell.value.result ?? 0) : cell.value);

test('presets are listed with their store roles', async () => {
  const list = JSON.parse((await request(server, '/api/presets')).body);
  const product = list.find(p => p.id === 'product-store-report');
  assert.equal(product.title, 'Product Store Report');
  assert.equal(product.available, true);
  assert.equal(product.stores[0].storeKey, 'shop');
});

test('preset requests are validated before any API work', async () => {
  const before = calls.list;
  for (const body of [{ preset: 'nope', start: '2026-11-02', end: '2026-11-08' }, { preset: 'product-store-report', start: '2026-11-08', end: '2026-11-02' }, { preset: 'product-store-report', start: 'x', end: '2026-11-08' }]) {
    assert.equal((await request(server, '/api/run', { method: 'POST', body })).status, 400);
  }
  assert.equal(calls.list, before);
});

test('Product Store Report: rows, corporate deduction, formulas and formats', async () => {
  const { result, download, workbook } = await runPreset('product-store-report');
  assert.match(download.headers['content-disposition'], /filename="Product Store Report \d{8}\.xlsx"/);
  const sheet = result.sheets[0];
  assert.equal(sheet.name, 'Product Store Report');
  // One row per line item placed in the week, newest order first; the March order is outside the range.
  assert.deepEqual(sheet.rows.map(r => r[0]), [5004, 5004, 5003, 5002, 5001]);
  const col = name => sheet.columns.findIndex(x => x.header === name);
  assert.deepEqual(sheet.rows.map(r => r[col('Order Type')]), ['Customer', 'Customer', 'Corporate', 'Needs review', 'Customer']);
  assert.equal(sheet.rows[0][col('Product Options')], 'Color: Blue, Size: Large');
  assert.equal(sheet.rows[1][col('Product Personalization')], 'Establishment Name\n- Establishment Name: Hotel One');
  assert.equal(sheet.rows[0][col('Placed')], '2026-11-08');
  assert.deepEqual(result.meta.summary, { orders: 4, gross: 185.5, corporate: 120, review: 20, canceled: 15 });

  const ws = workbook.getWorksheet('Product Store Report');
  assert.equal(ws.getCell('A1').value, 'Order #');
  assert.equal(ws.getCell('A2').value, 5004);
  assert.ok(ws.getCell('B2').value instanceof Date);
  assert.equal(ws.getCell('B2').numFmt, 'mm/dd/yyyy');
  assert.equal(ws.views[0].ySplit, 1);
  assert.ok(ws.autoFilter);
  // Footer: below the rows, a blank row, one note and another blank row.
  const total = col('Total Price') + 1;
  const footerRow = sheet.rows.length + 1 + 2 + 2;
  const at = offset => ws.getRow(footerRow + offset).getCell(total);
  assert.match(at(0).value.formula, /^SUMIFS\(J2:J6,C2:C6,"<>\*cancel\*"\)$/);
  assert.equal(value(at(0)), 185.5);
  assert.equal(value(at(1)), -120);
  assert.equal(at(2).value.formula, `J${footerRow}+J${footerRow + 1}`);
  assert.equal(value(at(2)), 65.5);
  assert.equal(value(at(3)), 20);
  assert.equal(value(at(4)), 15);
  assert.match(at(0).numFmt, /\$/);
  assert.equal(ws.getRow(footerRow + 2).getCell(col('Customer') + 1).value, 'Net sales (total sales - corporate orders)');
});

test('a second run reuses cached order details instead of calling the API again', async () => {
  orderCache.configure({ enabled: true });
  try {
    await runPreset('product-store-report');
    const before = calls.order;
    const { result } = await runPreset('product-store-report');
    assert.equal(calls.order, before);
    assert.equal(result.meta.stores.product.fromCache, 4);
  } finally {
    orderCache.configure({ enabled: false });
  }
});

test('Redemption Store Report: award rows, parsed award columns and quantity totals', async () => {
  const { result, workbook } = await runPreset('redemption-store-report');
  const sheet = result.sheets[0];
  const col = name => sheet.columns.findIndex(x => x.header === name);
  assert.deepEqual(sheet.rows.map(r => r[0]), [7003, 7003, 7002, 7001]);
  assert.equal(sheet.rows[0][col('Customer')], 'Lee Owner');
  assert.equal(sheet.rows[0][col('Item #')], 'SKU-PLAQUE-AWARD');
  assert.deepEqual(sheet.rows.map(r => [r[col('Award Type')], r[col('Award Level')], r[col('Redemption Code')]]),
    [['Plaque', '4-Star', 'R-1'], ['Crystal', '5-Star', 'R-2'], ['Plaque', 'Rec', 'R-3'], ['Crystal', '4-Star', 'R-4']]);
  assert.deepEqual(result.meta.summary, { orders: 3, awards: 4, canceledAwards: 1 });
  const ws = workbook.getWorksheet('Redemption Store Report');
  assert.equal(ws.getCell('L2').value, 0);
  assert.match(ws.getCell('L2').numFmt, /"-"/);
  assert.equal(ws.views[0].xSplit, 1);
  const qty = col('Quantity') + 1;
  const first = sheet.rows.length + 1 + 2;
  const labels = sheet.footer.map(r => r[col('Product Options')].v);
  assert.deepEqual(labels.slice(0, 3), ['5-Star Plaques', '4-Star Plaques', 'Rec Plaques']);
  const byLabel = Object.fromEntries(labels.map((l, i) => [l, ws.getRow(first + i).getCell(qty)]));
  assert.equal(value(byLabel['4-Star Plaques']), 1);
  assert.equal(value(byLabel['5-Star Crystals']), 2);
  assert.equal(value(byLabel['4-Star Crystals']), 0);
  assert.match(byLabel['4-Star Crystals'].value.formula, /"<>\*cancel\*"/);
  assert.equal(value(byLabel['Total awards redeemed']), 4);
  assert.equal(value(byLabel['Canceled (excluded)']), 1);
});

test('Summary Report: weekly and YTD awards, sales less corporate once, inventory inputs', async () => {
  const { result, workbook } = await runPreset('summary-report');
  assert.deepEqual(result.meta.summary.weeklyAwards, { '5-Star': { Plaque: 0, Crystal: 2 }, '4-Star': { Plaque: 1, Crystal: 0 }, Rec: { Plaque: 1, Crystal: 0 } });
  assert.deepEqual(result.meta.summary.sales, { ytd: { gross: 210.5, corporate: 120, review: 20 }, week: { gross: 185.5, corporate: 120, review: 20 } });
  const ws = workbook.getWorksheet('Summary');
  const find = label => { let hit; ws.eachRow((row, r) => { if (row.getCell(1).value === label && !hit) hit = r; }); assert.ok(hit, label); return hit; };
  assert.ok(ws.getCell('A1').value instanceof Date);
  assert.equal(ws.getCell('A2').value, '11/02/2026 - 11/08/2026');
  const ytdTotal = ws.getRow(find('YTD Total')).getCell(2);
  assert.equal(ytdTotal.value.formula, `B${find('Brand Store YTD')}-B${find('Corporate Orders YTD')}`);
  assert.equal(value(ytdTotal), 90.5);
  const weekly = ws.getRow(find('Brand Store Weekly Totals')).getCell(2);
  assert.equal(weekly.value.formula, `B${find('Brand Store Weekly')}-B${find('Brand Store Corporate Orders Weekly')}`);
  assert.equal(value(weekly), 65.5);
  const weeklyHead = find('Redemption Store Weekly');
  assert.equal(value(ws.getRow(weeklyHead + 4).getCell(4)), 4);
  assert.equal(ws.getRow(weeklyHead + 4).getCell(4).value.formula, `SUM(D${weeklyHead + 1}:D${weeklyHead + 3})`);
  const pins = ws.getRow(find('4-Star Flatback Clutch Pins')).getCell(2);
  assert.equal(pins.fill.fgColor.argb, 'FFFFF2CC');
  assert.equal(pins.protection.locked, false);
  const corp = result.sheets[1];
  assert.deepEqual(corp.rows.map(r => [r[0], r[2], r[8], r[9]]), [[5003, 'Corporate', 120, 'Yes'], [5002, 'Needs review', 20, 'Yes']]);
  assert.equal(corp.rows[0][6], 'Purchase Order');
});

test('Weekly FTG Tracking Reports: YTD sheets, shipments from late last year, empty VLR sheets', async () => {
  const { result, workbook } = await runPreset('weekly-ftg-tracking-reports');
  assert.deepEqual(result.sheets.map(s => s.name), ['Awards Redeemed YTD', 'Redemption Store Tracking', 'Product Store Orders Placed', 'Product Store Tracking', 'VLR Store Orders Placed', 'VLR Store Tracking']);
  const sheet = name => result.sheets.find(s => s.name === name);
  assert.deepEqual(sheet('Awards Redeemed YTD').rows, [
    [7003, '2026-11-07', 'Plaque Award', 1, 'Plaque', 'R-1', 'Hotel One'],
    [7003, '2026-11-07', 'Crystal Award', 2, 'Crystal', 'R-2', 'Spa Two'],
    [7002, '2026-11-02', 'Plaque Award', 1, 'Plaque', 'R-3', 'Bistro Three'],
  ]);
  // The December order is fetched through the lookback because it shipped in January.
  assert.deepEqual(sheet('Redemption Store Tracking').rows.map(r => [r[0], r[1], r[2], r[6], r[7]]), [
    [7003, '2026-11-07', '2026-11-08', 1, '1ZRED1'], [7003, '2026-11-07', '2026-11-08', 2, '1ZRED1'], [6001, '2025-12-20', '2026-01-06', 1, '1ZLATE'],
  ]);
  assert.deepEqual(sheet('Product Store Orders Placed').rows.map(r => r[0]), [5004, 5004, 5003, 5002, 4001]);
  // Order 5004 shipped on 11/09, after the end date, so it is not tracked yet.
  assert.deepEqual(sheet('Product Store Tracking').rows.map(r => [r[0], r[3], r[4], r[5], r[6]]), [[4001, 'Tote Bag', '', 'Black', 1]]);
  assert.equal(sheet('VLR Store Orders Placed').rows.length, 0);
  assert.match(result.meta.warnings.join(' '), /VLR Store is not configured/);
  const ws = workbook.getWorksheet('Redemption Store Tracking');
  assert.equal(ws.getCell('H2').value, '1ZRED1');
  assert.equal(ws.getCell('H2').numFmt, '@');
  assert.ok(ws.getCell('C2').value instanceof Date);
  assert.equal(workbook.worksheets.length, 6);
});
