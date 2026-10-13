const ExcelJS = require('exceljs');
const { buildTableView } = require('../public/reportView');

let exporting = false;
function badRequest(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
const numericColumns = new Set(['Unit Price', 'Total Price', 'Tax Total', 'Order Total', 'Order Item Total',
  'Order Sales Tax', 'Order Shipping Sales Tax', 'Order Discounts', 'Store Shipping Cost', 'Shipping Landded Cost',
  'Base Price', 'Options Price', 'Logo Charges', 'Original Quantity', 'Shipped Quantity', 'Unique Item Count', 'Shipment Count']);
const quantityColumns = new Set(['Original Quantity', 'Shipped Quantity', 'Unique Item Count', 'Shipment Count']);
const dateColumns = new Set(['Placed', 'Ship Date', 'First Ship Date', 'Last Ship Date', 'In-Hands Date']);
function cellValue(column, value) {
  if (value === '' || value == null) return null;
  if (numericColumns.has(column) && String(value).trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (dateColumns.has(column)) {
    const raw = String(value);
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = match ? `${match[3]}-${match[1]}-${match[2]}` : raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const date = new Date(iso);
      if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso) return date;
    }
  }
  // Source data is always literal; only our navigation templates create formulas.
  return String(value);
}
function validateSelection(selection, table) {
  if (selection === undefined) return { columns: table.columns, splitPairs: false };
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).some(k => !['columns', 'splitPairs'].includes(k))) throw badRequest('Invalid workbook selection settings.');
  if (selection.splitPairs !== undefined && typeof selection.splitPairs !== 'boolean') throw badRequest('splitPairs must be a boolean.');
  const columns = selection.columns === undefined ? table.columns : selection.columns;
  if (!Array.isArray(columns) || columns.some(c => typeof c !== 'string' || !table.columns.includes(c))
    || new Set(columns).size !== columns.length) throw badRequest('Workbook columns must be valid, unique report columns.');
  return { columns, splitPairs: selection.splitPairs === true };
}
function validateKeys(tables) {
  if (!tables || !tables.order || !tables.shipment) throw badRequest('Excel export requires both report tables.');
  const parents = new Set();
  for (const [level, table] of Object.entries(tables)) {
    if (!['order', 'shipment'].includes(level) || !Array.isArray(table.rows) || !Array.isArray(table.columns)
      || !Array.isArray(table.rowKeys) || table.rowKeys.length !== table.rows.length
      || table.rowKeys.some(k => typeof k !== 'string' || k === '')) throw badRequest('Invalid report table keys.');
  }
  for (const key of tables.order.rowKeys) {
    if (parents.has(key)) throw badRequest('Duplicate parent order key in workbook.');
    parents.add(key);
  }
  for (const key of tables.shipment.rowKeys) if (!parents.has(key)) throw badRequest('Shipment row has no matching parent order.');
}
async function exportReportWorkbook({ tables, selections = {} }) {
  if (exporting) throw Object.assign(new Error('Another Excel export is running. Try again shortly.'), { statusCode: 429 });
  exporting = true;
  try {
    validateKeys(tables);
    if (!selections || typeof selections !== 'object' || Array.isArray(selections)
      || Object.keys(selections).some(k => !['order', 'shipment'].includes(k))) throw badRequest('Invalid workbook table selections.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BrightSites Exporter';
    workbook.calcProperties.fullCalcOnLoad = true;
    const childCounts = new Map();
    for (const key of tables.shipment.rowKeys) childCounts.set(key, (childCounts.get(key) || 0) + 1);
    for (const level of ['order', 'shipment']) {
      const table = tables[level];
      const selected = validateSelection(selections[level], table);
      const view = buildTableView(table, { deselectedColumns: table.columns.filter(c => !selected.columns.includes(c)), splitPairs: selected.splitPairs });
      const sheet = workbook.addWorksheet(level === 'order' ? 'Order Level' : 'Shipment Level', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
      const columns = ['Order Key', ...view.columns, ...(level === 'order' ? ['View Shipments', 'Shipment Detail Rows'] : ['View Order'])];
      if (columns.length > 16384) throw badRequest('The report has too many columns for Excel. Select fewer columns.');
      const rows = view.rows.map((row, index) => {
        const key = view.rowKeys[index];
        const count = childCounts.get(key) || 0;
        let links;
        if (level === 'order') {
          links = count ? [
            { formula: 'IFERROR(HYPERLINK("#\'Shipment Level\'!A"&(MATCH([@[Order Key]],ShipmentsTable[Order Key],0)+ROW(ShipmentsTable[#Headers])),"View Shipments"),"No shipment items")', result: 'View Shipments' },
            { formula: 'COUNTIF(ShipmentsTable[Order Key],[@[Order Key]])', result: count },
          ] : ['No shipment items', tables.shipment.rows.length ? { formula: 'COUNTIF(ShipmentsTable[Order Key],[@[Order Key]])', result: 0 } : 0];
        } else {
          links = [{ formula: 'IFERROR(HYPERLINK("#\'Order Level\'!A"&(MATCH([@[Order Key]],OrdersTable[Order Key],0)+ROW(OrdersTable[#Headers])),"View Order"),"")', result: 'View Order' }];
        }
        return [key, ...row.map((value, i) => cellValue(view.columns[i], value)), ...links];
      });
      if (rows.length) sheet.addTable({ name: level === 'order' ? 'OrdersTable' : 'ShipmentsTable', ref: 'A1', headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: columns.map(name => ({ name, filterButton: true })), rows });
      else sheet.addRow(columns);
      sheet.getRow(1).height = 32;
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
      sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
      columns.forEach((name, i) => {
        const column = sheet.getColumn(i + 1);
        column.width = Math.min(45, Math.max(18, name.length + 2));
        column.alignment = { vertical: 'top', wrapText: true };
        if (numericColumns.has(name)) column.numFmt = quantityColumns.has(name) ? '0.##' : '#,##0.00';
        if (dateColumns.has(name)) column.numFmt = 'mm/dd/yyyy';
      });
      for (let index = 2; index <= rows.length + 1; index++) {
        const excelRow = sheet.getRow(index);
        excelRow.height = 30;
        const link = excelRow.getCell(columns.length - (level === 'order' ? 1 : 0));
        if (link.value && typeof link.value === 'object' && link.value.formula) link.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  } finally { exporting = false; }
}
module.exports = { exportReportWorkbook };
