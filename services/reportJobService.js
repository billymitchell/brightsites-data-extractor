const { randomUUID } = require('crypto');

const { ALL_COLUMNS, MAX_REPORT_ROWS } = require('../config/report');
const { getRunContext, validateRunRequest } = require('./orderService');
const { buildReportRows } = require('./reportRowBuilder');
const { createCanceledError, isCanceledError } = require('../utils/cancel');
const { logError, logInfo } = require('../utils/logger');

const ups = require('../lib/ups');

const jobs = new Map();
const HISTORY_LIMIT = 50;
const history = [];

function recordHistory(job) {
  const started = Date.parse(job.startedAt || job.createdAt);
  const ended = Date.parse(job.completedAt);
  history.push({
    id: job.id,
    status: job.status,
    storeKey: job.request.storeKey,
    start: job.request.start,
    end: job.request.end,
    statusFilter: job.request.status,
    createdAt: job.createdAt,
    durationSec: Number.isNaN(ended - started) ? null : Math.round((ended - started) / 100) / 10,
    orders: job.progress && job.progress.ordersTotal,
    rows: job.progress && job.progress.rowsBuilt,
    error: job.error,
  });
  if (history.length > HISTORY_LIMIT) history.shift();
}

function getJobHistory() {
  return history.slice();
}
const JOB_TTL_MS = Math.max(60000, Number(process.env.REPORT_JOB_TTL_MS || 4 * 60 * 60 * 1000));
const CLEANUP_INTERVAL_MS = Math.max(30000, Number(process.env.REPORT_JOB_CLEANUP_INTERVAL_MS || 10 * 60 * 1000));
const MAX_ACTIVE_JOBS = Math.max(1, Number(process.env.REPORT_JOB_MAX_ACTIVE) || 2);
const MAX_RETAINED_RESULTS = Math.max(1, Number(process.env.REPORT_JOB_MAX_RETAINED_RESULTS) || 5);

function evictOldestCompletedResults() {
  const completed = Array.from(jobs.entries())
    .filter(([, job]) => job.status === 'completed' && job.result)
    .sort((a, b) => Date.parse(a[1].completedAt) - Date.parse(b[1].completedAt));

  while (completed.length > MAX_RETAINED_RESULTS) {
    const [, oldestJob] = completed.shift();
    oldestJob.result = null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createProgress(progress = {}) {
  return Object.assign({ phase: 'queued', message: 'Job queued.', updatedAt: nowIso() }, progress);
}

function cleanupExpiredJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  jobs.forEach((job, jobId) => {
    if (!job.completedAt) return;
    const completedAtMs = Date.parse(job.completedAt);
    if (!Number.isNaN(completedAtMs) && completedAtMs < cutoff) {
      jobs.delete(jobId);
    }
  });
}

const cleanupTimer = setInterval(cleanupExpiredJobs, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    canceledAt: job.canceledAt,
    cancelRequested: job.cancelRequested,
    request: job.request,
    progress: job.progress,
    error: job.error,
    resultAvailable: Boolean(job.result),
    statusUrl: `/api/run/${job.id}`,
    resultUrl: `/api/run/${job.id}/result`,
    cancelUrl: `/api/run/${job.id}/cancel`,
  };
}

function updateJobProgress(job, progress = {}) {
  if (!job) return;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') return;
  const nextProgress = Object.assign({}, job.progress || {}, progress);
  delete nextProgress.updatedAt;
  job.progress = createProgress(nextProgress);
}

function finalizeCanceledJob(job, message) {
  const timestamp = nowIso();
  job.status = 'canceled';
  job.canceledAt = timestamp;
  job.completedAt = timestamp;
  job.result = null;
  job.error = null;
  job.progress = createProgress({
    phase: 'canceled',
    message: message || 'Report job canceled.',
  });
  recordHistory(job);
}

async function runJob(job) {
  if (!job || job.status === 'canceled') return;

  if (job.cancelRequested) {
    finalizeCanceledJob(job, 'Report job canceled before it started.');
    return;
  }

  job.status = 'running';
  job.startedAt = nowIso();
  updateJobProgress(job, {
    phase: 'starting',
    message: 'Starting report job.',
  });

  try {
    const context = await getRunContext(job.request, {
      isCanceled: () => job.cancelRequested,
      onProgress: (progress) => updateJobProgress(job, progress),
    });

    if (job.cancelRequested) throw createCanceledError();

    const report = await buildReportRows({
      orders: context.orders,
      storeOpts: context.storeOpts,
      debugInfo: context.debugInfo,
      maxRows: MAX_REPORT_ROWS,
      isCanceled: () => job.cancelRequested,
      onProgress: (progress) => updateJobProgress(job, progress),
    });

    if (job.cancelRequested) throw createCanceledError();

    let columns = ALL_COLUMNS;
    let upsInfo = null;
    if (job.request.includeUps) {
      if (!ups.isConfigured()) throw new Error('UPS lookup is not set up on this server (UPS_CLIENT_ID / UPS_CLIENT_SECRET missing).');
      upsInfo = await ups.enrichRowsWithUps(report.rows, ALL_COLUMNS.indexOf('Tracking #'), {
        isCanceled: () => job.cancelRequested,
        onProgress: (progress) => updateJobProgress(job, progress),
      });
      columns = ALL_COLUMNS.concat(ups.UPS_COLUMNS);
      if (job.cancelRequested) throw createCanceledError();
    }

    const meta = {
      orders: context.orders.length,
      rows: report.rows.length,
    };
    if (upsInfo) meta.ups = upsInfo;
    if (report.debugInfo) meta.debug = report.debugInfo;

    job.result = {
      columns,
      rows: report.rows,
      meta,
    };
    job.status = 'completed';
    job.completedAt = nowIso();
    evictOldestCompletedResults();
    job.progress = createProgress({
      phase: 'completed',
      ordersProcessed: context.orders.length,
      ordersTotal: context.orders.length,
      rowsBuilt: report.rows.length,
      message: `Report ready. ${report.rows.length} rows built from ${context.orders.length} orders.`,
    });

    recordHistory(job);
    logInfo('services/reportJobService.runJob', `Completed report job ${job.id}`, {
      jobId: job.id,
      storeKey: job.request.storeKey,
      orders: meta.orders,
      rows: meta.rows,
    });
  } catch (err) {
    if (isCanceledError(err) || job.cancelRequested) {
      finalizeCanceledJob(job, 'Report job canceled.');
      logInfo('services/reportJobService.runJob', `Canceled report job ${job.id}`, {
        jobId: job.id,
        storeKey: job.request.storeKey,
      });
      return;
    }

    job.status = 'failed';
    job.completedAt = nowIso();
    job.error = err && err.message ? err.message : String(err);
    job.progress = createProgress({
      phase: 'failed',
      message: 'Report job failed.',
    });

    recordHistory(job);
    logError('services/reportJobService.runJob', err, {
      jobId: job.id,
      storeKey: job.request.storeKey,
    });
  }
}

function createJob(body = {}) {
  validateRunRequest(body);
  cleanupExpiredJobs();
  const activeJobs = Array.from(jobs.values())
    .filter((job) => ['queued', 'running', 'canceling'].includes(job.status)).length;
  if (activeJobs >= MAX_ACTIVE_JOBS) {
    const err = new Error(`Report job limit reached. Wait for an active job to finish (maximum ${MAX_ACTIVE_JOBS}).`);
    err.statusCode = 429;
    throw err;
  }

  const job = {
    id: randomUUID(),
    status: 'queued',
    request: {
      storeKey: body.storeKey,
      start: body.start,
      end: body.end,
      status: body.status || '',
      includeUps: body.includeUps === true,
    },
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelRequested: false,
    progress: createProgress({
      phase: 'queued',
      message: 'Job queued.',
    }),
    error: null,
    result: null,
  };

  jobs.set(job.id, job);
  logInfo('services/reportJobService.createJob', `Queued report job ${job.id}`, {
    jobId: job.id,
    storeKey: job.request.storeKey,
  });

  setImmediate(() => {
    runJob(job).catch((err) => {
      job.status = 'failed';
      job.completedAt = nowIso();
      job.error = err && err.message ? err.message : String(err);
      job.progress = createProgress({
        phase: 'failed',
        message: 'Report job failed.',
      });
      recordHistory(job);
      logError('services/reportJobService.runJobUnhandled', err, {
        jobId: job.id,
        storeKey: job.request.storeKey,
      });
    });
  });

  return serializeJob(job);
}

function getJob(jobId) {
  cleanupExpiredJobs();
  const job = jobs.get(jobId);
  if (!job) return null;
  return serializeJob(job);
}

function getJobRecord(jobId) {
  cleanupExpiredJobs();
  return jobs.get(jobId) || null;
}

function cancelJob(jobId) {
  const job = getJobRecord(jobId);
  if (!job) return null;

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') {
    return serializeJob(job);
  }

  job.cancelRequested = true;

  if (job.status === 'queued') {
    finalizeCanceledJob(job, 'Report job canceled before it started.');
  } else {
    job.status = 'canceling';
    updateJobProgress(job, {
      phase: 'canceling',
      message: 'Cancel requested. Waiting for the active BrightSites request to finish.',
    });
  }

  logInfo('services/reportJobService.cancelJob', `Cancel requested for report job ${job.id}`, {
    jobId: job.id,
    storeKey: job.request.storeKey,
  });

  return serializeJob(job);
}

function getJobResult(jobId) {
  const job = getJobRecord(jobId);
  if (!job) return null;

  return {
    job,
    result: job.result,
  };
}

module.exports = {
  createJob,
  getJob,
  cancelJob,
  getJobResult,
  getJobHistory,
};
