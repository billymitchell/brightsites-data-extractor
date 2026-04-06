const express = require('express');

const usage = require('../lib/usage');
const { getConfiguredStores } = require('../config/stores');
const { FREE_LIMIT, RESERVE, OVERAGE_RATE } = require('../config/report');

const router = express.Router();

router.get('/usage', (req, res) => {
  const month = req.query.month || usage.monthKey();
  const storeKey = req.query.store;
  const stores = getConfiguredStores();
  const monthData = usage.getMonth(month);
  const calc = (count) => usage.metricsFor(count, {
    freeLimit: FREE_LIMIT,
    reserve: RESERVE,
    rate: OVERAGE_RATE,
  });

  if (storeKey) {
    const count = monthData[storeKey] || 0;
    return res.json({ month, store: storeKey, metrics: calc(count) });
  }

  const all = {};
  Object.keys(stores).forEach((key) => {
    all[key] = calc(monthData[key] || 0);
  });
  Object.keys(monthData).forEach((key) => {
    if (!all[key]) all[key] = calc(monthData[key]);
  });
  return res.json({ month, stores: all });
});

router.post('/usage/reset', (req, res) => {
  const body = req.body || {};
  const month = body.month || usage.monthKey();
  usage.reset(month);
  res.json({ ok: true, month });
});

module.exports = router;
