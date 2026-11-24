const c = require('./common');

const LEVELS = [['5-Star', '5-Star'], ['4-Star', '4-Star'], ['Rec', 'Rec']];
const TYPES = ['Plaque', 'Crystal'];
// Counted by hand each week, so these are left as input cells.
const INVENTORY = [
  '5-Star Plaque - Clear Acrylic', '4-Star Plaque - Clear Acrylic', 'Rec Plaque - Clear Acrylic',
  '5-Star Flatback Clutch Pins', '4-Star Flatback Clutch Pins', 'Rec Flatback Clutch Pins',
  '5-Star Flatback Clutch Pin PACKS', '4-Star Flatback Clutch Pin PACKS', 'Rec Flatback Clutch Pin PACKS',
  '5-Star Magnetic Pin PACKS', '4-Star Magnetic Pin PACKS', 'Rec Magnetic Pin PACKS',
];

const usDate = iso => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
const round = n => Math.round(n * 100) / 100;
const lineTotal = items => items.reduce((sum, li) => sum + c.money(li.total_price), 0);

function awardCounts(entries, range) {
  const counts = Object.fromEntries(LEVELS.map(([level]) => [level, { Plaque: 0, Crystal: 0 }]));
  const unmatched = new Set();
  for (const { order, line_items: items } of entries) {
    if (c.isCanceled(order) || !c.inRange(c.placedDate(order), range)) continue;
    for (const li of items) {
      const { type, level } = c.awardInfo(li);
      if (counts[level] && TYPES.includes(type)) counts[level][type] += c.quantity(li.quantity);
      else unmatched.add(c.orderNumber(order));
    }
  }
  return { counts, unmatched };
}

function salesTotals(entries, range) {
  const out = { gross: 0, corporate: 0, review: 0, orders: [] };
  for (const { order, line_items: items } of entries) {
    if (c.isCanceled(order) || !c.inRange(c.placedDate(order), range)) continue;
    const amount = lineTotal(items);
    out.gross += amount;
    const { category, reason } = c.corporateCategory(order);
    if (category === c.CORPORATE) out.corporate += amount;
    if (category === c.NEEDS_REVIEW) out.review += amount;
    if (category !== c.CUSTOMER) out.orders.push({ order, category, reason, amount });
  }
  return { gross: round(out.gross), corporate: round(out.corporate), review: round(out.review), orders: out.orders };
}

function build({ stores, ranges, generatedAt }) {
  const rows = [];
  const add = (...cells) => { rows.push(cells); return rows.length; };
  const blank = () => add();
  const money = (v, extra = {}) => ({ v, t: 'currency', ...extra });

  add({ v: generatedAt, t: 'date', b: true });
  add({ v: `${usDate(ranges.selected.start)} - ${usDate(ranges.selected.end)}`, b: true });
  blank();

  const warnings = [];
  const awardBlock = (title, range) => {
    const { counts, unmatched } = awardCounts(stores.redemption.orders, range);
    if (unmatched.size) warnings.push(`${title}: award type or level could not be read on order(s) ${[...unmatched].join(', ')}, so they are not counted.`);
    const head = add({ v: title, b: true, section: true }, { v: 'Plaques', b: true, section: true }, { v: 'Crystals', b: true, section: true }, { v: 'Total', b: true, section: true });
    for (const [level, label] of LEVELS) {
      const r = rows.length + 1;
      add(label, { v: counts[level].Plaque, t: 'integer' }, { v: counts[level].Crystal, t: 'integer' },
        { f: `B${r}+C${r}`, v: counts[level].Plaque + counts[level].Crystal, t: 'integer' });
    }
    const first = head + 1;
    const last = head + LEVELS.length;
    const sum = type => LEVELS.reduce((n, [level]) => n + counts[level][type], 0);
    add({ v: 'Total', b: true },
      { f: `SUM(B${first}:B${last})`, v: sum('Plaque'), t: 'integer', b: true },
      { f: `SUM(C${first}:C${last})`, v: sum('Crystal'), t: 'integer', b: true },
      { f: `SUM(D${first}:D${last})`, v: sum('Plaque') + sum('Crystal'), t: 'integer', b: true });
    blank();
    return counts;
  };
  const weeklyAwards = awardBlock('Redemption Store Weekly', ranges.selected);
  const ytdAwards = awardBlock('Redemption Store YTD', ranges.ytd);

  const ytd = salesTotals(stores.product.orders, ranges.ytd);
  const week = salesTotals(stores.product.orders, ranges.selected);
  add({ v: 'Sales', b: true, section: true }, { v: '', section: true }, { v: '', section: true }, { v: '', section: true });
  const ytdGross = add('Brand Store YTD', money(ytd.gross));
  const ytdCorp = add('Corporate Orders YTD', money(ytd.corporate));
  add({ v: 'YTD Total', b: true }, money(round(ytd.gross - ytd.corporate), { f: `B${ytdGross}-B${ytdCorp}`, b: true }),
    { v: 'Brand Store YTD - Corporate Orders YTD', i: true });
  const weekGross = add('Brand Store Weekly', money(week.gross));
  const weekCorp = add('Brand Store Corporate Orders Weekly', money(week.corporate));
  add({ v: 'Brand Store Weekly Totals', b: true }, money(round(week.gross - week.corporate), { f: `B${weekGross}-B${weekCorp}`, b: true }),
    { v: 'Brand Store Weekly - Corporate Orders Weekly', i: true });
  add('Needs review YTD (not deducted)', money(ytd.review), { v: 'See the Corporate Orders sheet', i: true });
  add('Needs review Weekly (not deducted)', money(week.review));
  blank();

  add({ v: 'Inventory', b: true, section: true }, { v: generatedAt, t: 'date', b: true, section: true }, { v: 'Notes', b: true, section: true }, { v: '', section: true });
  for (const label of INVENTORY) add(label, { v: '', input: true }, { v: '', input: true });

  const summarySheet = { name: 'Summary', kind: 'layout', widths: [36, 15, 15, 12], rows };

  const flagged = ytd.orders.sort((a, b) => c.compareOrdersDesc({ order: a.order }, { order: b.order }));
  const corporateSheet = {
    name: 'Corporate Orders', kind: 'table',
    columns: [
      { header: 'Order #', type: 'id', width: 10 },
      { header: 'Placed', type: 'date', width: 12 },
      { header: 'Order Type', width: 14 },
      { header: 'Reason', width: 52, wrap: true },
      { header: 'Customer', width: 24 },
      { header: 'Customer E-Mail', width: 30 },
      { header: 'Payment Method', width: 18 },
      { header: 'Payment Note', width: 30, wrap: true },
      { header: 'Order Total', type: 'currency', width: 14 },
      { header: 'In Selected Week', width: 10 },
    ],
    rows: flagged.map(({ order, category, reason, amount }) => {
      const details = (order.payment && order.payment.details) || {};
      return [c.orderNumber(order), c.placedDate(order), category, reason, c.customerName(order), c.text(order.customer_email),
        c.text(details['custom method name'] || details.method), c.text(details.details || details.note),
        round(amount), c.inRange(c.placedDate(order), ranges.selected) ? 'Yes' : 'No'];
    }),
    notes: ['Corporate = Purchase Order payment AND a payment note mentioning "FTG Accounting". Needs review = only part of that rule matched; these are not deducted.'],
  };

  return {
    sheets: [summarySheet, corporateSheet],
    summary: {
      weeklyAwards, ytdAwards,
      sales: { ytd: { gross: ytd.gross, corporate: ytd.corporate, review: ytd.review }, week: { gross: week.gross, corporate: week.corporate, review: week.review } },
    },
    warnings,
  };
}

module.exports = {
  id: 'summary-report',
  program: 'ftg',
  title: 'Summary Report',
  description: 'Weekly and year-to-date award counts and Brand Store sales, less corporate orders, with an inventory section to fill in.',
  rangeHelp: 'The start and end dates are the week. Year to date runs from January 1 of the end date\'s year to the end date.',
  stores: { product: { required: true, fetch: 'ytd' }, redemption: { required: true, fetch: 'ytd' } },
  build,
};
