const express = require('express');

const { getConfiguredStores } = require('../config/stores');

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

module.exports = router;
