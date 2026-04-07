const express = require('express');

const { createJob, getJob, getJobResult, cancelJob } = require('../services/reportJobService');
const { logError, logWarn } = require('../utils/logger');

const router = express.Router();

router.post('/run', async (req, res) => {
  try {
    const job = createJob(req.body || {});
    return res.status(202).json(job);
  } catch (err) {
    const requestMeta = {
      method: req.method,
      path: req.originalUrl,
      storeKey: req.body && req.body.storeKey,
      start: req.body && req.body.start,
      end: req.body && req.body.end,
      status: req.body && req.body.status,
    };
    if (err && err.statusCode) {
      logWarn('routes/reportRoutes.postRun', err.message, Object.assign({}, requestMeta, {
        statusCode: err.statusCode,
      }));
      return res.status(err.statusCode).json({ error: err.message });
    }
    logError('routes/reportRoutes.postRun', err, requestMeta);
    return res.status(500).json({ error: String(err) });
  }
});

router.get('/run/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: `Job '${req.params.jobId}' not found.` });
  }
  return res.json(job);
});

router.get('/run/:jobId/result', (req, res) => {
  const payload = getJobResult(req.params.jobId);
  if (!payload) {
    return res.status(404).json({ error: `Job '${req.params.jobId}' not found.` });
  }

  const { job, result } = payload;
  if (job.status === 'completed' && result) {
    return res.json(result);
  }
  if (job.status === 'failed') {
    return res.status(500).json({ error: job.error || 'Report job failed.', status: job.status });
  }
  if (job.status === 'canceled') {
    return res.status(409).json({ error: 'Report job was canceled before completion.', status: job.status });
  }

  return res.status(409).json({ error: 'Report job is still running.', status: job.status });
});

router.post('/run/:jobId/cancel', (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: `Job '${req.params.jobId}' not found.` });
  }
  return res.json(job);
});

module.exports = router;
