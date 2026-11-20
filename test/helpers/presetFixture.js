// Synthetic, non-PII orders for preset report tests, shaped like BrightSites GET /orders/:id.
const STORES = {
  shop: { subdomain: 'fixture-shop', token: 'shop-token', label: 'Fixture Shop', role: 'product' },
  redeem: { subdomain: 'fixture-redemption', token: 'redeem-token', label: 'Fixture Redemption', role: 'redemption' },
};

const address = (company = '') => ({ company, first_address: '1 Test Way', second_address: '', city: 'Testville', state: 'NY', country: 'US', zip: '10001' });
const contact = (first, last) => ({ first_name: first, last_name: last, email: `${first.toLowerCase()}@example.com`, phone: '' });
const payment = (method, custom, note) => ({ id: 1, amount: '0', state: 'completed', details: { method, 'custom method name': custom, details: note, amount: '0' } });

let nextItem = 1;
function item(name, quantity, total, { options = [], personalization = null } = {}) {
  return {
    id: nextItem++, name, final_sku: `SKU-${name.replace(/\W+/g, '-').toUpperCase()}`, quantity,
    total_price: String(total), product_options: options.map(([option_name, sub_option_name]) => ({ option_name, sub_option_name })),
    product_personalizations: personalization ? [personalization] : [],
  };
}

function order(id, created, { status = 'shipped', email, billing = contact('Pat', 'Buyer'), company = '', pay = payment('credit_card', '', ''), items, shipments = [] }) {
  return {
    order_id: id, created_at: created, updated_at: created, status, username: billing.first_name.toLowerCase(),
    customer_email: email || billing.email, billing_contact: billing, shipping_contact: billing,
    billing_address: address(company), shipping_address: address(company), payment: pay,
    line_items: items, shipments,
  };
}

function establishment(code, name) {
  return {
    title: 'Establishment Details',
    attributes: [
      { key: 'Redemption Code', value: code },
      { key: 'Official Establishment Name', value: `${name} Official` },
      { key: 'Personalized Establishment Name', value: name },
    ],
  };
}

function build() {
  nextItem = 1;
  const plaque = item('Plaque Award', 1, '0.0', { options: [['Version', 'Plaque, 4 Star, 2026, Hotel']], personalization: establishment('R-1', 'Hotel One') });
  const crystal5 = item('Crystal Award', 2, '0.0', { options: [['Version', 'Crystal, 5 Star, 2026, Spa']], personalization: establishment('R-2', 'Spa Two') });
  const plaqueRec = item('Plaque Award', 1, '0.0', { options: [['Version', 'Plaque, Recommended, 2026, Restaurant']], personalization: establishment('R-3', 'Bistro Three') });
  const canceledRedeem = item('Crystal Award', 1, '0.0', { options: [['Version', 'Crystal, 4 Star, 2026, Hotel']], personalization: establishment('R-4', 'Hotel Four') });
  const shopA = item('Logo Mug', 2, '30.00', { options: [['Color', 'Blue'], ['Size', 'Large']] });
  const shopB = item('Window Decal', 1, '15.50', { personalization: { title: 'Establishment Name', attributes: [{ key: 'Establishment Name', value: 'Hotel One' }] } });
  const corp = item('Desk Plaque', 3, '120.00');
  const review = item('Lapel Pin', 4, '20.00');
  const canceled = item('Logo Mug', 1, '15.00', { options: [['Color', 'Red']] });
  const older = item('Tote Bag', 1, '25.00', { options: [['Color', 'Black']] });
  const oldAward = item('Plaque Award', 1, '0.0', { options: [['Version', 'Plaque, 5 Star, 2025, Hotel']], personalization: establishment('R-0', 'Old Hotel') });
  const ship = (id, date, tracking, items) => ({ id, ship_date: date, tracking_number: `${tracking} `, line_items: items.map(([li, quantity]) => ({ id: li.id, quantity })) });
  return {
    shop: [
      order(5004, '2026-11-08T15:00:00Z', { items: [shopA, shopB], shipments: [ship(1, '2026-11-09', '1ZSHOP1', [[shopA, 2], [shopB, 1]])] }),
      order(5003, '2026-11-05T15:00:00Z', { billing: contact('Acct', 'Team'), email: 'acct@forbestravelguide.com', company: 'Wrong Hotel', pay: payment('custom', 'Purchase Order', 'Attn: FTG Accounting'), items: [corp] }),
      order(5002, '2026-11-04T15:00:00Z', { billing: contact('Sam', 'Staff'), email: 'sam@forbestravelguide.com', items: [review] }),
      order(5001, '2026-11-03T15:00:00Z', { status: 'canceled', items: [canceled] }),
      // Placed before the selected week but this year: only in YTD and tracking sheets.
      order(4001, '2026-03-02T15:00:00Z', { items: [older], shipments: [ship(2, '2026-03-04', '1ZOLD', [[older, 1]])] }),
    ],
    redeem: [
      order(7003, '2026-11-07T15:00:00Z', { billing: contact('Lee', '  Owner '), items: [plaque, crystal5], shipments: [ship(3, '2026-11-08', '1ZRED1', [[plaque, 1], [crystal5, 2]])] }),
      order(7002, '2026-11-02T15:00:00Z', { billing: contact('Kim', 'Chef'), items: [plaqueRec] }),
      order(7001, '2026-11-02T18:00:00Z', { status: 'canceled', billing: contact('Ash', 'Host'), items: [canceledRedeem] }),
      // Placed last year, shipped this year: belongs on the tracking sheet only.
      order(6001, '2025-12-20T15:00:00Z', { billing: contact('Old', 'Order'), items: [oldAward], shipments: [ship(4, '2026-01-06', '1ZLATE', [[oldAward, 1]])] }),
    ],
  };
}

// Installs stubs on lib/brightSites; call before requiring services that destructure it.
function install(sites, data = build()) {
  const bySubdomain = Object.fromEntries(Object.entries(STORES).map(([key, s]) => [s.subdomain, data[key] || []]));
  const calls = { list: 0, order: 0 };
  sites.fetchAllPages = async (path, params, perPage, opts) => {
    calls.list++;
    const from = Date.parse(params.created_at_from);
    const to = Date.parse(params.created_at_to);
    return (bySubdomain[opts.subdomain] || [])
      .filter(o => Date.parse(o.created_at) >= from && Date.parse(o.created_at) <= to)
      .map(o => ({ order_id: o.order_id, created_at: o.created_at, updated_at: o.updated_at, status: o.status, customer: o.customer_email }));
  };
  sites.loadOrder = async (orderId, opts) => {
    calls.order++;
    const hit = (bySubdomain[opts.subdomain] || []).find(o => String(o.order_id) === String(orderId));
    if (!hit) throw new Error(`fixture order ${orderId} not found`);
    return JSON.parse(JSON.stringify(hit));
  };
  sites.loadLineItems = async () => { throw new Error('line items are embedded in fixture orders'); };
  sites.loadShipments = async () => { throw new Error('shipments are embedded in fixture orders'); };
  return calls;
}

module.exports = { STORES, build, install };
