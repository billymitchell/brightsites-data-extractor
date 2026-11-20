const c = require('./common');
const { columnLetter } = require('./workbook');

const COLUMNS = [
  { header: 'Order #', type: 'id', width: 10 },
  { header: 'Customer', width: 24 },
  { header: 'Username', width: 18 },
  { header: 'Customer E-Mail', width: 30 },
  { header: 'Order Status', width: 13 },
  { header: 'Placed', type: 'date', width: 12 },
  { header: 'Item #', width: 18 },
  { header: 'Product Name', width: 30, wrap: true },
  { header: 'Product Personalization', width: 44, wrap: true },
  { header: 'Product Options', width: 34, wrap: true },
  { header: 'Quantity', type: 'integer', width: 10 },
  { header: 'Product Total', type: 'accounting', width: 14 },
  { header: 'Shipping State', width: 10 },
  { header: 'Shipping Country', width: 10 },
  // Added: parsed from the Version option and personalization so awards can be filtered and counted.
  { header: 'Award Type', width: 11 },
  { header: 'Award Level', width: 11 },
  { header: 'Redemption Code', width: 18 },
];
const col = name => COLUMNS.findIndex(x => x.header === name);

// Quantity totals as live formulas, by award type and level, excluding canceled orders.
function awardFooter(rows) {
  const width = COLUMNS.length;
  const last = rows.length + 1;
  const range = name => `${columnLetter(col(name))}2:${columnLetter(col(name))}${last}`;
  const active = row => !/cancel/i.test(String(row[col('Order Status')]));
  const line = (label, f, v, bold = false) => {
    const row = new Array(width).fill('');
    row[col('Product Options')] = { v: label, b: bold };
    row[col('Quantity')] = rows.length ? { f, v, t: 'integer', b: bold } : { v: 0, t: 'integer', b: bold };
    return row;
  };
  const notCanceled = `${range('Order Status')},"<>*cancel*"`;
  const lines = [];
  for (const type of ['Plaque', 'Crystal']) {
    for (const level of ['5-Star', '4-Star', 'Rec']) {
      const v = rows.filter(r => active(r) && r[col('Award Type')] === type && r[col('Award Level')] === level)
        .reduce((n, r) => n + r[col('Quantity')], 0);
      lines.push(line(`${level} ${type}s`, `SUMIFS(${range('Quantity')},${range('Award Type')},"${type}",${range('Award Level')},"${level}",${notCanceled})`, v));
    }
  }
  const total = rows.filter(active).reduce((n, r) => n + r[col('Quantity')], 0);
  lines.push(line('Total awards redeemed', `SUMIFS(${range('Quantity')},${notCanceled})`, total, true));
  const canceled = rows.filter(r => !active(r)).reduce((n, r) => n + r[col('Quantity')], 0);
  lines.push(line('Canceled (excluded)', `SUMIFS(${range('Quantity')},${range('Order Status')},"*cancel*")`, canceled));
  return { lines, total, canceled };
}

function build({ stores, ranges }) {
  const entries = stores.redemption.orders
    .filter(e => c.inRange(c.placedDate(e.order), ranges.selected))
    .sort(c.compareOrdersDesc);
  const rows = [];
  const unparsed = new Set();
  for (const { order, line_items: items } of entries) {
    for (const li of items) {
      const award = c.awardInfo(li);
      if (!award.type || !award.level) unparsed.add(c.orderNumber(order));
      rows.push([
        c.orderNumber(order),
        c.customerName(order),
        c.text(order.username),
        c.text(order.customer_email),
        c.text(order.status),
        c.placedDate(order),
        c.text(li.final_sku || li.sku),
        c.text(li.name || li.product_name),
        c.personalizationText(li),
        c.optionsText(li),
        c.quantity(li.quantity),
        c.money(li.total_price),
        c.text(order.shipping_address && order.shipping_address.state),
        c.text(order.shipping_address && order.shipping_address.country),
        award.type,
        award.level,
        c.personalizationValue(li, 'Redemption Code'),
      ]);
    }
  }
  const footer = awardFooter(rows);
  const warnings = unparsed.size
    ? [`Award type or level could not be read from the Version option on order(s) ${[...unparsed].join(', ')}.`]
    : [];
  return {
    sheets: [{ name: 'Redemption Store Report', kind: 'table', columns: COLUMNS, rows, footer: footer.lines, freezeColumns: 1 }],
    summary: { orders: entries.length, awards: footer.total, canceledAwards: footer.canceled },
    warnings,
  };
}

module.exports = {
  id: 'redemption-store-report',
  title: 'Redemption Store Report',
  description: 'Every award redeemed in the Redemption Store between the start and end dates, with counts by award type and level.',
  rangeHelp: 'Uses orders placed from the start date to the end date.',
  stores: { redemption: { required: true, fetch: 'selected' } },
  build,
  COLUMNS,
};
