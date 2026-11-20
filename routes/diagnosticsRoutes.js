const express = require('express');

const { collect, plainSummary } = require('../services/diagnostics');
const { logWarn } = require('../utils/logger');

const router = express.Router();
// Rate-limit browser error reports per minute instead of a lifetime cap that silences them forever.
const CLIENT_EVENTS_PER_MINUTE = 30;
let clientEventWindow = { start: 0, count: 0 };

router.get('/diagnostics', (req, res) => res.json(collect()));

router.get('/diagnostics/report', (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="support-report-${stamp}.txt"`);
  res.send(plainSummary(collect()));
});

router.post('/diagnostics/client-event', (req, res) => {
  const now = Date.now();
  if (now - clientEventWindow.start >= 60000) clientEventWindow = { start: now, count: 0 };
  clientEventWindow.count += 1;
  if (clientEventWindow.count <= CLIENT_EVENTS_PER_MINUTE) {
    const b = req.body || {};
    logWarn('browser', String(b.message || 'Browser error').slice(0, 300), {
      page: String(b.page || '').slice(0, 200),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    });
  }
  res.status(204).end();
});

module.exports = router;
