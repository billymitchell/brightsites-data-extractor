const express = require('express');

const { listStoresForClient } = require('../config/stores');

const { getReportColumnConfig } = require('../config/report');
const { UPS_COLUMNS } = require('../lib/ups');
const { listPresets } = require('../services/presets');

const router = express.Router();

router.get('/stores', (req, res) => {
  res.json(listStoresForClient());
});

router.get('/columns', (req, res) => {
  try {
    const config = getReportColumnConfig(req.query.reportLevel);
    const groups = req.query.reportLevel === 'order' ? config.groups
      : config.groups.concat([{ label: 'UPS tracking', columns: UPS_COLUMNS }]);
    res.json({ groups, core: config.core });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/presets', (req, res) => {
  res.json(listPresets());
});

module.exports = router;
