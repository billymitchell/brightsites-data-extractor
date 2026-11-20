const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../services/presets/common');

const po = (custom, note) => ({ payment: { details: { method: 'custom', 'custom method name': custom, details: note } } });

test('corporate orders need both a Purchase Order payment and an FTG Accounting note', () => {
  assert.equal(c.corporateCategory(po('Purchase Order', 'Attn: FTG Accounting')).category, 'Corporate');
  assert.equal(c.corporateCategory(po('purchase order', 'attn ftg  accounting dept')).category, 'Corporate');
  // Variances are categorised for review instead of being deducted.
  const onlyPo = c.corporateCategory(po('Purchase Order', 'Attn: Events'));
  assert.equal(onlyPo.category, 'Needs review');
  assert.match(onlyPo.reason, /missing FTG Accounting note/);
  assert.equal(c.corporateCategory(po('Check', 'FTG Accounting')).category, 'Needs review');
  const staff = c.corporateCategory({ customer_email: 'someone@ForbesTravelGuide.com', payment: { details: { method: 'credit_card' } } });
  assert.equal(staff.category, 'Needs review');
  assert.match(staff.reason, /@forbestravelguide.com email; missing Purchase Order payment and FTG Accounting note/);
  // The billing company is not trusted: a corporate order may name a hotel.
  assert.equal(c.corporateCategory({ ...po('Purchase Order', 'Attn: FTG Accounting'), billing_address: { company: 'Some Hotel' } }).category, 'Corporate');
  assert.equal(c.corporateCategory({ billing_address: { company: 'FTG Accounting' } }).category, 'Customer');
  assert.equal(c.corporateCategory({ payments: [{ details: { 'custom method name': 'Purchase Order', details: 'FTG Accounting' } }] }).category, 'Corporate');
});

test('award details are read from the Version option', () => {
  const li = v => ({ product_options: [{ option_name: 'Version', sub_option_name: v }] });
  assert.deepEqual(c.awardInfo(li('Plaque, 4 Star, 2026, Hotel')), { type: 'Plaque', level: '4-Star', year: '2026', category: 'Hotel' });
  assert.deepEqual(c.awardInfo(li('Crystal, Five-Star, 2026, Spa')).level, '5-Star');
  assert.deepEqual(c.awardInfo(li('Crystal, Recommended, 2026, Restaurant')).level, 'Rec');
  assert.deepEqual(c.awardInfo({ product_options: [{ option_name: 'Award Level', sub_option_name: '5 Star' }] }).level, '5-Star');
  assert.deepEqual(c.awardInfo({}), { type: '', level: '', year: '', category: '' });
});

test('line item text matches the BrightSites export layout', () => {
  const li = {
    product_options: [{ option_name: 'Color', sub_option_name: ' Blue ' }, { option_name: 'Size', sub_option_name: 'L' }],
    product_personalizations: [{ title: 'Establishment Details', attributes: [{ key: 'Redemption Code', value: 'R-1' }, { key: 'Personalized Establishment Name', value: 'Hotel  One' }] }],
  };
  assert.equal(c.optionsText(li), 'Color: Blue, Size: L');
  assert.equal(c.optionValue(li, 'size'), 'L');
  assert.equal(c.personalizationText(li), 'Establishment Details\n- Redemption Code: R-1\n- Personalized Establishment Name: Hotel One');
  assert.equal(c.personalizationValue(li, 'personalized establishment name'), 'Hotel One');
  assert.equal(c.customerName({ billing_contact: { first_name: 'Lee', last_name: '  Owner ' } }), 'Lee Owner');
});

test('store roles come from config or the store label', () => {
  const roles = c.resolveStoreRoles({
    a: { label: 'FTG Shop', subdomain: 'ftg-shop' },
    b: { label: 'FTG Redemption', subdomain: 'ftg-redemption' },
    v: { label: 'Something', role: 'vlr' },
  });
  assert.deepEqual(Object.fromEntries(Object.entries(roles).map(([r, s]) => [r, s.storeKey])), { product: 'a', redemption: 'b', vlr: 'v' });
});
