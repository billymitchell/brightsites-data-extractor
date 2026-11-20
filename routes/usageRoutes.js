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
    if (!Object.hasOwn(stores, storeKey)) return res.status(404).json({ error: 'Store not found.' });
    const count = monthData[storeKey] || 0;
    return res.json({ month, store: storeKey, metrics: calc(count) });
  }

  const all = {};
  Object.keys(stores).forEach((key) => {
    all[key] = calc(monthData[key] || 0);
  });
  // Only configured stores are reported; older usage files may hold keys that were API tokens.
  return res.json({ month, stores: all });
});

module.exports = router;
