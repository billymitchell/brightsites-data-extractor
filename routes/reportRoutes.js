const express = require('express');

const { createJob, getJob, getJobResult, cancelJob } = require('../services/reportJobService');
const { exportReportWorkbook } = require('../services/workbookExportService');
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
  if (job.status === 'completed' && !result) {
    return res.status(410).json({ error: 'Report result expired because the retained-results limit was reached.', status: job.status });
  }

  return res.status(409).json({ error: 'Report job is still running.', status: job.status });
});

router.post('/run/:jobId/workbook', async (req, res) => {
  const payload = getJobResult(req.params.jobId);
  if (!payload) return res.status(404).json({ error: 'Report job not found.' });
  const { job, result } = payload;
  if (job.status === 'failed') return res.status(500).json({ error: job.error || 'Report job failed.' });
  if (job.status !== 'completed') return res.status(409).json({ error: 'Report is not available for download.' });
  if (!result) return res.status(410).json({ error: 'Report result has expired. Run the report again.' });
  if (!result.tables) return res.status(400).json({ error: 'Choose Both tables (Excel) to export a linked workbook.' });
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => key !== 'selections')) {
      return res.status(400).json({ error: 'Only workbook selection settings are accepted.' });
    }
    const buffer = await exportReportWorkbook({ tables: result.tables, selections: req.body.selections });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="brightsites_orders_and_shipments.xlsx"');
    return res.send(buffer);
  } catch (err) {
    if (!err.statusCode) logError('routes/reportRoutes.workbook', err, { jobId: req.params.jobId });
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/run/:jobId/cancel', (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: `Job '${req.params.jobId}' not found.` });
  }
  return res.json(job);
});

module.exports = router;
