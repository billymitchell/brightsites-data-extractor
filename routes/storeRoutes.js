const express = require('express');

const { getConfiguredStores } = require('../config/stores');

const { getReportColumnConfig } = require('../config/report');
const { UPS_COLUMNS } = require('../lib/ups');

const router = express.Router();

router.get('/stores', (req, res) => {
  const stores = getConfiguredStores();
  const out = Object.entries(stores).map(([key, value]) => ({
    key,
    label: value.label || key,
    subdomain: value.subdomain,
  }));
  res.json(out);
});

router.get('/columns', (req, res) => {
  try {
    const config = getReportColumnConfig(req.query.reportLevel);
    const groups = req.query.reportLevel === 'order' ? config.groups
      : config.groups.concat([{ label: 'UPS tracking (when enabled)', columns: UPS_COLUMNS }]);
    res.json({ groups, core: config.core });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
