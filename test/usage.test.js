const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
process.env.USAGE_FILE = path.join(dir, 'usage.json');
const usage = require('../lib/usage');

test('usage increments are batched and flushed to disk', () => {
  for (let i = 0; i < 500; i++) usage.increment('shop-a', 1);
  assert.equal(fs.existsSync(process.env.USAGE_FILE), false, 'no synchronous write per increment');
  assert.equal(usage.getStore('shop-a'), 500);
  usage.flush();
  const saved = JSON.parse(fs.readFileSync(process.env.USAGE_FILE, 'utf8'));
  assert.equal(saved[usage.monthKey()]['shop-a'], 500);
  fs.rmSync(dir, { recursive: true, force: true });
});
