const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRIGHTSITES_STORES = JSON.stringify({
  test: { subdomain: 'example', token: 'test-token' },
});
process.env.REPORT_JOB_MAX_ACTIVE = '1';

const logger = require('../utils/logger');
logger.logInfo = () => {};
logger.logError = () => {};

const { createJob, cancelJob } = require('../services/reportJobService');

test('rejects report jobs when the active-job limit is reached', () => {
  const job = createJob({
    storeKey: 'test',
    start: '2026-02-01',
    end: '2026-02-02',
  });

  assert.throws(
    () => createJob({
      storeKey: 'test',
      start: '2026-02-01',
      end: '2026-02-02',
    }),
    { statusCode: 429 }
  );

  assert.equal(cancelJob(job.id).status, 'canceled');
});
