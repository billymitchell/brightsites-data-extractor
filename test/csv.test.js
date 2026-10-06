const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeCsvCell } = require('../public/csv');

test('escapes CSV delimiters, quotes, and line breaks', () => {
  assert.equal(escapeCsvCell('plain'), 'plain');
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hello"'), '"say ""hello"""');
  assert.equal(escapeCsvCell('first\nsecond'), '"first\nsecond"');
  assert.equal(escapeCsvCell(null), '');
});

test('neutralizes spreadsheet formulas and control-character prefixes', () => {
  for (const value of ['=1+1', '+1', '-1+1', '@SUM(A1:A2)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    assert.match(escapeCsvCell(value), /^(?:"')|^'/, value);
  }
  assert.equal(escapeCsvCell(-1), '-1');
  assert.equal(escapeCsvCell('-12.50'), '-12.50');
});
