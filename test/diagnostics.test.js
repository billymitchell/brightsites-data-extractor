const test = require('node:test');
const assert = require('node:assert');

const logger = require('../utils/logger');
const { collect, plainSummary } = require('../services/diagnostics');

test('log buffer hides secrets and support report is readable', () => {
  const fs = require('fs');
  const orig = fs.appendFileSync;
  fs.appendFileSync = () => {};
  const origLog = console.warn; console.warn = () => {};
  try {
    logger.logWarn('test', 'something odd', { token: 'abc123', nested: { password: 'pw' }, ok: 1 });
  } finally { fs.appendFileSync = orig; console.warn = origLog; }
  const text = plainSummary(collect());
  assert.ok(text.includes('SUPPORT REPORT'));
  assert.ok(text.includes('something odd'));
  assert.ok(!text.includes('abc123'));
  assert.ok(!text.includes('"pw"'));
});
