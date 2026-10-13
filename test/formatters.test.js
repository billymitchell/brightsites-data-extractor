const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOptionPairs } = require('../utils/formatters');

test('uses arbitrary option keys consistently for structured, text, and keyed options', () => {
  const expected = [
    ['Product Option: Finish', 'Matte'],
    ['Product Option: Engraving Location', 'Back'],
  ];
  for (const options of [
    [{ option_name: 'Finish', sub_option_name: 'Matte' }, { option_name: 'Engraving Location', sub_option_name: 'Back' }],
    'Finish: Matte; Engraving Location: Back',
    { Finish: 'Matte', 'Engraving Location': 'Back' },
  ]) {
    assert.deepEqual(extractOptionPairs(options), expected);
  }
});

test('preserves unlabeled option values instead of inventing column keys', () => {
  for (const value of ['Plaque, 4 Star, 2026, Hotel', '2026 Edition', 'Plaque, 4 Star, Hotel', 'Plaque, 4 Star, , Hotel',
    'Plaque, 4 Star, not a year, Hotel', 'Plaque, 4 Star, 2026, Hotel, Extra']) {
    assert.deepEqual(extractOptionPairs([{ option_name: 'Version', sub_option_name: value }]),
      [['Product Option: Version', value]]);
  }
});

test('accepts new key/value options and preserves zero and false values', () => {
  assert.deepEqual(extractOptionPairs([
    { key: 'Proof Required', value: false },
    { key: 'Additional Copies', value: 0 },
    { key: 'Finish', value: 'Matte' },
  ]), [
    ['Product Option: Proof Required', 'false'],
    ['Product Option: Additional Copies', '0'],
    ['Product Option: Finish', 'Matte'],
  ]);
});

test('keeps separately named options and comma-containing values intact', () => {
  assert.deepEqual(extractOptionPairs([
    { option_name: 'Award Level', sub_option_name: '5 Star' },
    { option_name: 'Partner Status', sub_option_name: 'Partner' },
    { option_name: 'Color', sub_option_name: 'Red, White, Blue' },
  ]), [
    ['Product Option: Award Level', '5 Star'],
    ['Product Option: Partner Status', 'Partner'],
    ['Product Option: Color', 'Red, White, Blue'],
  ]);
});

test('date-only API dates keep their calendar date across time zones', () => {
  const { formatDateMDY } = require('../utils/formatters');
  assert.equal(formatDateMDY('2026-02-01'), '02/01/2026');
  assert.equal(formatDateMDY('2026-02-30'), '');
});
