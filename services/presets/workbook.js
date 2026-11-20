const ExcelJS = require('exceljs');

// Sheet model shared by the preview and the workbook:
//   { name, kind: 'table' | 'layout', columns: [{ header, type, width, wrap }], rows, footer, widths, notes }
// A cell is a primitive or { v, f, t, b, i, input }: value, formula, type, bold, italic, input cell.
// Types: text | id | date | integer | currency | accounting.

const FORMATS = {
  date: 'mm/dd/yyyy',
  integer: '#,##0',
  currency: '"$"#,##0.00;[Red]-"$"#,##0.00',
  // Shows "-" for zero, as in the Redemption Store template.
  accounting: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
};
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };

const asCell = cell => (cell !== null && typeof cell === 'object' && !(cell instanceof Date) ? cell : { v: cell });

function excelValue(value, type) {
  if (value === '' || value == null) return null;
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  if (['integer', 'currency', 'accounting'].includes(type) && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

function writeCell(sheetCell, raw, columnType) {
  const cell = asCell(raw);
  const type = cell.t || columnType || 'text';
  if (cell.f) sheetCell.value = { formula: cell.f, result: excelValue(cell.v, type) ?? undefined };
  else sheetCell.value = excelValue(cell.v, type);
  if (FORMATS[type]) sheetCell.numFmt = FORMATS[type];
  if (type === 'id' || type === 'text') sheetCell.numFmt = sheetCell.numFmt || (typeof sheetCell.value === 'string' ? '@' : 'General');
  if (cell.b || cell.i) sheetCell.font = { bold: Boolean(cell.b), italic: Boolean(cell.i) };
  if (cell.section) sheetCell.fill = SECTION_FILL;
  if (cell.input) {
    sheetCell.fill = INPUT_FILL;
    sheetCell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    sheetCell.protection = { locked: false };
  }
}

function renderTable(ws, sheet) {
  const columns = sheet.columns;
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: sheet.freezeColumns || 0 }];
  const header = ws.getRow(1);
  columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
    const col = ws.getColumn(i + 1);
    col.width = column.width || Math.min(40, Math.max(12, column.header.length + 2));
    col.alignment = { vertical: 'top', wrapText: Boolean(column.wrap) };
  });
  header.height = 30;
  sheet.rows.forEach((row, r) => {
    const excelRow = ws.getRow(r + 2);
    row.forEach((value, c) => writeCell(excelRow.getCell(c + 1), value, columns[c] && columns[c].type));
  });
  const lastDataRow = sheet.rows.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastDataRow, column: columns.length } };
  let next = lastDataRow + 2;
  for (const note of sheet.notes || []) writeCell(ws.getRow(next++).getCell(1), { v: note, i: true });
  next = footerStartRow(sheet);
  for (const row of sheet.footer || []) {
    const excelRow = ws.getRow(next++);
    row.forEach((value, c) => { if (value !== null && value !== undefined && value !== '') writeCell(excelRow.getCell(c + 1), value, columns[c] && columns[c].type); });
  }
}

function renderLayout(ws, sheet) {
  (sheet.widths || []).forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  sheet.rows.forEach((row, r) => {
    const excelRow = ws.getRow(r + 1);
    (row || []).forEach((value, c) => {
      if (value === null || value === undefined || value === '') return;
      const styled = typeof value === 'object' && (value.input || value.section);
      if (!styled && (asCell(value).v === '' || asCell(value).v == null) && !asCell(value).f) return;
      writeCell(excelRow.getCell(c + 1), value);
      excelRow.getCell(c + 1).alignment = { vertical: 'top', wrapText: c > 0 && typeof asCell(value).v === 'string' && String(asCell(value).v).length > 30 };
    });
  });
}

async function renderWorkbook(result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BrightSites Exporter';
  workbook.calcProperties.fullCalcOnLoad = true;
  for (const sheet of result.sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    if (sheet.kind === 'layout') renderLayout(ws, sheet);
    else renderTable(ws, sheet);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Excel row number of the first footer line of a table sheet (rows, a blank row, notes and a blank row).
function footerStartRow(sheet) {
  const notes = (sheet.notes || []).length;
  return sheet.rows.length + 1 + 2 + (notes ? notes + 1 : 0);
}

// Column letter for a 0-based index (0 -> A).
function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

module.exports = { renderWorkbook, columnLetter, footerStartRow, FORMATS };
