const express = require('express');

const { getConfiguredStores } = require('../config/stores');

const { COLUMN_GROUPS, COLUMNS } = require('../config/report');
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
  res.json({
    groups: COLUMN_GROUPS.concat([{ label: 'UPS tracking (when enabled)', columns: UPS_COLUMNS }]),
    core: COLUMNS,
  });
});

module.exports = router;
