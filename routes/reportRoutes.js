const express = require('express');

const { ALL_COLUMNS } = require('../config/report');
const { getRunContext } = require('../services/orderService');
const { buildReportRows } = require('../services/reportRowBuilder');
const { logError, logWarn } = require('../utils/logger');

const router = express.Router();

router.post('/run', async (req, res) => {
  try {
    const { orders, debugInfo, storeOpts } = await getRunContext(req.body || {});
    const report = await buildReportRows({ orders, storeOpts, debugInfo });
    const meta = { orders: orders.length, rows: report.rows.length };
    if (report.debugInfo) meta.debug = report.debugInfo;
    return res.json({ columns: ALL_COLUMNS, rows: report.rows, meta });
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

module.exports = router;
