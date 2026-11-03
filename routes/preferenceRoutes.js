const express = require('express');
const { normalizeCompanyEmail } = require('../middleware/emailAuth');
const { logError } = require('../utils/logger');

function createPreferenceRoutes(service) {
  const router = express.Router();
  router.get('/preferences/columns', async (req, res) => {
    if (!req.auth) return res.json({ account: false });
    const email = normalizeCompanyEmail(req.auth.email);
    if (!email) return res.status(403).json({ error: 'A verified company account is required.' });
    try {
      return res.json({ account: true, layouts: await service.load(email) });
    } catch (error) {
      logError('routes.preferences.load', error);
      return res.status(503).json({ error: 'Could not load your account column defaults. Please retry.' });
    }
  });
  router.put('/preferences/columns/:level', async (req, res) => {
    const email = req.auth && normalizeCompanyEmail(req.auth.email);
    if (!email) return res.status(403).json({ error: 'Sign in with a company account to save defaults.' });
    try {
      await service.save(email, req.params.level, req.body);
      return res.json({ saved: true });
    } catch (error) {
      logError('routes.preferences.save', error);
      const status = error.statusCode === 400 ? 400 : 503;
      return res.status(status).json({ error: status === 400 ? error.message : 'Your column changes were not saved to your account. Please retry.' });
    }
  });
  return router;
}

module.exports = { createPreferenceRoutes };
