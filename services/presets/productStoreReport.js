const c = require('./common');
const { columnLetter, footerStartRow } = require('./workbook');

const COLUMNS = [
  { header: 'Order #', type: 'id', width: 10 },
  { header: 'Placed', type: 'date', width: 12 },
  { header: 'Order Status', width: 13 },
  { header: 'MOAS Approver/Denier', width: 22 },
  { header: 'Product Name', width: 34, wrap: true },
  { header: 'Product Personalization', width: 40, wrap: true },
  { header: 'Product Options', width: 34, wrap: true },
  { header: 'Customer', width: 24 },
  { header: 'Quantity', type: 'integer', width: 10 },
  { header: 'Total Price', type: 'currency', width: 14 },
  { header: 'Customer E-Mail', width: 30 },
  { header: 'Billing Company', width: 26, wrap: true },
  { header: 'Billing Address', width: 40, wrap: true },
  { header: 'Shipping Country', width: 16 },
  // Added: makes the corporate deduction auditable and filterable.
  { header: 'Order Type', width: 16 },
];
const col = name => COLUMNS.findIndex(x => x.header === name);

// Builds the sales totals block below a line-item table, as live formulas over the rows.
function salesFooter(rows, { labelColumn, amountColumn, statusColumn, typeColumn }) {
  const width = COLUMNS.length;
  const amount = columnLetter(amountColumn);
  const status = columnLetter(statusColumn);
  const type = columnLetter(typeColumn);
  const last = rows.length + 1;
  const sumWhere = predicate => rows.reduce((sum, row) => (predicate(row) ? sum + (Number(row[amountColumn]) || 0) : sum), 0);
  const active = row => !/cancel/i.test(String(row[statusColumn]));
  const totals = {
    gross: sumWhere(active),
    corporate: sumWhere(row => active(row) && row[typeColumn] === c.CORPORATE),
    review: sumWhere(row => active(row) && row[typeColumn] === c.NEEDS_REVIEW),
    canceled: sumWhere(row => !active(row)),
  };
  const round = n => Math.round(n * 100) / 100;
  const range = letter => `${letter}2:${letter}${last}`;
  const formula = (f, v) => (rows.length ? { f, v: round(v), t: 'currency' } : { v: 0, t: 'currency' });
  const line = (label, cell, bold = false) => {
    const row = new Array(width).fill('');
    row[labelColumn] = { v: label, b: bold };
    row[amountColumn] = { ...cell, b: bold };
    return row;
  };
  return {
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])),
    lines: [
      line('Total sales', formula(`SUMIFS(${range(amount)},${range(status)},"<>*cancel*")`, totals.gross)),
      line('Corporate orders', formula(`-SUMIFS(${range(amount)},${range(type)},"${c.CORPORATE}",${range(status)},"<>*cancel*")`, -totals.corporate)),
      line('Net sales (total sales - corporate orders)', formula('', totals.gross - totals.corporate), true),
      line('Needs review (not deducted)', formula(`SUMIFS(${range(amount)},${range(type)},"${c.NEEDS_REVIEW}",${range(status)},"<>*cancel*")`, totals.review)),
      line('Canceled (excluded)', formula(`SUMIFS(${range(amount)},${range(status)},"*cancel*")`, totals.canceled)),
    ],
  };
}

// Net sales = the "Total sales" line + the (negative) "Corporate orders" line directly above it.
function linkNetSales(sheet, amountColumn) {
  if (!sheet.rows.length) return;
  const first = footerStartRow(sheet);
  const amount = columnLetter(amountColumn);
  sheet.footer[2][amountColumn].f = `${amount}${first}+${amount}${first + 1}`;
}

function build({ stores, ranges }) {
  const entries = stores.product.orders
    .filter(e => c.inRange(c.placedDate(e.order), ranges.selected))
    .sort(c.compareOrdersDesc);
  const rows = [];
  for (const { order, line_items: items } of entries) {
    const { category } = c.corporateCategory(order);
    for (const li of items) {
      rows.push([
        c.orderNumber(order),
        c.placedDate(order),
        c.text(order.status),
        '',
        c.text(li.name || li.product_name),
        c.personalizationText(li),
        c.optionsText(li),
        c.customerName(order),
        c.quantity(li.quantity),
        c.money(li.total_price),
        c.text(order.customer_email),
        c.text(order.billing_address && order.billing_address.company),
        c.addressText(order.billing_address),
        c.text(order.shipping_address && order.shipping_address.country),
        category,
      ]);
    }
  }
  const notes = ['MOAS Approver/Denier is not available from the BrightSites API, so that column is left blank.'];
  const footer = salesFooter(rows, {
    labelColumn: col('Customer'), amountColumn: col('Total Price'),
    statusColumn: col('Order Status'), typeColumn: col('Order Type'),
  });
  const sheet = { name: 'Product Store Report', kind: 'table', columns: COLUMNS, rows, notes, footer: footer.lines };
  linkNetSales(sheet, col('Total Price'));
  return {
    sheets: [sheet],
    summary: { orders: entries.length, ...footer.totals },
    warnings: [notes[0]],
  };
}

module.exports = {
  id: 'product-store-report',
  program: 'ftg',
  title: 'Product Store Report',
  description: 'Every line item placed in the Product Store between the start and end dates, with sales totals that take off corporate orders.',
  rangeHelp: 'Uses orders placed from the start date to the end date.',
  stores: { product: { required: true, fetch: 'selected' } },
  build,
  salesFooter,
  linkNetSales,
  COLUMNS,
};
