const express = require('express');

const { collect, plainSummary } = require('../services/diagnostics');
const { logWarn } = require('../utils/logger');

const router = express.Router();
let clientEventCount = 0;

router.get('/diagnostics', (req, res) => res.json(collect()));

router.get('/diagnostics/report', (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="support-report-${stamp}.txt"`);
  res.send(plainSummary(collect()));
});

router.post('/diagnostics/client-event', (req, res) => {
  clientEventCount += 1;
  if (clientEventCount <= 500) {
    const b = req.body || {};
    logWarn('browser', String(b.message || 'Browser error').slice(0, 300), {
      page: String(b.page || '').slice(0, 200),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    });
  }
  res.status(204).end();
});

module.exports = router;
