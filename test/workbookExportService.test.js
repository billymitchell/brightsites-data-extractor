const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { exportReportWorkbook } = require('../services/workbookExportService');
function tables() {
  return {
    order: { columns: ['Order #', 'Order Total', 'Product Options'], rows: [['00100', '125.00', 'Finish: Matte; Glossy'], ['00200', '0.00', '']], rowKeys: ['shop:100', 'shop:200'], rowDetails: [{ options: [['Product Option: Finish', '7: Matte; 8: Glossy']] }, {}] },
    shipment: { columns: ['Order #', 'Line Item ID', 'Original Quantity', 'Product Options', 'Tracking #'], rows: [['00100', '7', '3', '=literal'], ['00100', '7', '3', '+literal'], ['00100', '8', '2', 'Glossy']], rowKeys: ['shop:100', 'shop:100', 'shop:100'], rowDetails: [{ options: [['Product Option: Finish', 'Matte']] }, { options: [['Product Option: Finish', 'Matte']] }, { options: [['Product Option: Late Key', 'Glossy']] }] },
  };
}
async function read(buffer) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); return workbook; }
test('Excel export produces two linked native tables and typed literal cells', async () => {
  const workbook = await read(await exportReportWorkbook({ tables: tables() }));
  assert.deepEqual(workbook.worksheets.map(s => s.name), ['Order Level', 'Shipment Level']);
  const order = workbook.getWorksheet('Order Level'), shipment = workbook.getWorksheet('Shipment Level');
  assert.ok(order.getTable('OrdersTable'));
  assert.ok(shipment.getTable('ShipmentsTable'));
  assert.equal(order.getCell('A2').value, 'shop:100');
  assert.equal(shipment.getCell('A4').value, 'shop:100');
  assert.equal(order.getCell('B2').value, '00100');
  assert.equal(order.getCell('C2').value, 125);
  assert.equal(shipment.getCell('D2').value, 3);
  assert.equal(shipment.getCell('E2').value, '=literal');
  assert.equal(shipment.getCell('E3').value, '+literal');
  assert.equal(order.getCell('F2').value.result, 3);
  assert.match(order.getCell('F2').value.formula, /OrdersTable\[\[#This Row\],\[Order Key\]\]/);
  assert.match(shipment.getCell('G2').value.formula, /ShipmentsTable\[\[#This Row\],\[Order Key\]\]/);
  assert.match(order.getCell('E2').value.formula, /MATCH\(.*ShipmentsTable\[Order Key\]/);
  assert.equal(order.getCell('E3').value, 'No shipment items');
  assert.match(shipment.getCell('G2').value.formula, /MATCH\(.*OrdersTable\[Order Key\]/);
  assert.equal(shipment.getCell('G2').value.result, 'View Order');
  assert.equal(order.views[0].ySplit, 1);
});
test('mandatory relationship columns survive empty selections and dynamic splitting', async () => {
  const workbook = await read(await exportReportWorkbook({ tables: tables(), selections: { order: { columns: [], splitPairs: true }, shipment: { columns: ['Product Options'], splitPairs: true } } }));
  assert.deepEqual(workbook.getWorksheet('Order Level').getRow(1).values.slice(1), ['Order Key', 'View Shipments', 'Shipment Detail Rows']);
  assert.deepEqual(workbook.getWorksheet('Shipment Level').getRow(1).values.slice(1), ['Order Key', 'Product Option: Finish', 'Product Option: Late Key', 'View Order']);
});
test('workbook selection order matches preview order while retaining required navigation columns', async () => {
  const workbook = await read(await exportReportWorkbook({ tables: tables(), selections: {
    order: { columns: ['Order Total', 'Order #'] },
    shipment: { columns: ['Product Options', 'Original Quantity', 'Order #'], splitPairs: true },
  } }));
  const order = workbook.getWorksheet('Order Level'), shipment = workbook.getWorksheet('Shipment Level');
  assert.deepEqual(order.getRow(1).values.slice(1), ['Order Key', 'Order Total', 'Order #', 'View Shipments', 'Shipment Detail Rows']);
  assert.equal(order.getCell('B2').value, 125);
  assert.equal(order.getCell('C2').value, '00100');
  assert.deepEqual(shipment.getRow(1).values.slice(1), ['Order Key', 'Product Option: Finish', 'Product Option: Late Key',
    'Original Quantity', 'Order #', 'View Order']);
  assert.equal(shipment.getCell('B2').value, 'Matte');
  assert.equal(shipment.getCell('D2').value, 3);
  assert.equal(shipment.getCell('E2').value, '00100');
});
test('duplicate parents, orphan details and invalid selection settings reject export', async () => {
  let input = tables(); input.order.rowKeys[1] = input.order.rowKeys[0];
  await assert.rejects(exportReportWorkbook({ tables: input }), /duplicate/i);
  input = tables(); input.shipment.rowKeys[0] = 'missing';
  await assert.rejects(exportReportWorkbook({ tables: input }), /parent/i);
  for (const selections of [{ order: { columns: ['unknown'] } }, { other: {} }, { order: { splitPairs: 'yes' } }, { order: { rows: [] } }]) {
    await assert.rejects(exportReportWorkbook({ tables: tables(), selections }), { statusCode: 400 });
  }
});
test('empty export keeps two headers and uses no fabricated records or invalid references', async () => {
  const input = tables(); for (const table of Object.values(input)) { table.rows = []; table.rowDetails = []; table.rowKeys = []; }
  const workbook = await read(await exportReportWorkbook({ tables: input }));
  assert.equal(workbook.worksheets.length, 2);
  for (const sheet of workbook.worksheets) assert.equal(sheet.rowCount, 1);
  input.order.rows = [['00100', '125.00', '']]; input.order.rowKeys = ['shop:100'];
  const withParent = await read(await exportReportWorkbook({ tables: input }));
  assert.equal(withParent.getWorksheet('Order Level').getCell('E2').value, 'No shipment items');
  assert.equal(withParent.getWorksheet('Order Level').getCell('F2').value, 0);
});
test('one workbook builds at a time and the lock releases after completion', async () => {
  const one = exportReportWorkbook({ tables: tables() });
  await assert.rejects(exportReportWorkbook({ tables: tables() }), { statusCode: 429 });
  await one;
  assert.ok((await exportReportWorkbook({ tables: tables() })).length > 0);
});
module.exports = { tables };

test('Excel quantity formats do not add decimal punctuation to whole counts', async () => {
  const workbook = await read(await exportReportWorkbook({ tables: tables() }));
  assert.equal(workbook.getWorksheet('Shipment Level').getCell('D2').numFmt, '0');
});
test('oversized workbooks reject with guidance before allocation', async () => {
  const input = tables();
  input.shipment.rows = Array.from({ length: 10001 }, () => ['00100']);
  input.shipment.rowKeys = input.shipment.rows.map(() => 'shop:100');
  await assert.rejects(exportReportWorkbook({ tables: input }), /Excel.*limit|Excel.*maximum/i);
});

test('wide workbooks enforce a cell budget as well as a row budget', async () => {
  const input = tables();
  input.shipment.columns = Array.from({ length: 50 }, (_, i) => `Field ${i}`);
  input.shipment.rows = Array.from({ length: 2000 }, () => input.shipment.columns.map(() => 'Sample'));
  input.shipment.rowKeys = input.shipment.rows.map(() => 'shop:100');
  await assert.rejects(exportReportWorkbook({ tables: input }), /cell limit/i);
});

test('dynamic cell budget rejects before materializing the rows-by-keys matrix', async () => {
  const input = tables();
  input.shipment.columns = ['Order #', 'Product Options'];
  input.shipment.rows = Array.from({ length: 1000 }, () => {
    const row = ['00100', ''];
    Object.defineProperty(row, 0, { get() { throw new Error('Detail matrix allocated before budget check'); } });
    return row;
  });
  input.shipment.rowKeys = input.shipment.rows.map(() => 'shop:100');
  input.shipment.rowDetails = input.shipment.rows.map((row, index) => ({ options: [[`Product Option: Key ${index}`, 'value']] }));
  await assert.rejects(exportReportWorkbook({ tables: input, selections: { shipment: { splitPairs: true } } }), /cell limit/i);
});
