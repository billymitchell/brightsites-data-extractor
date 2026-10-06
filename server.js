const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const { PORT } = require('./config/report');
const reportRoutes = require('./routes/reportRoutes');
const storeRoutes = require('./routes/storeRoutes');
const usageRoutes = require('./routes/usageRoutes');
const diagnosticsRoutes = require('./routes/diagnosticsRoutes');
const { requestTracker } = require('./services/diagnostics');
const { logError, logInfo } = require('./utils/logger');
const { createAuth } = require('./middleware/auth');
const { securityHeaders, requireHttps } = require('./middleware/security');

const isProduction = process.env.NODE_ENV === 'production';
const authEnabled = Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);
if (!authEnabled) {
  if (isProduction) {
    console.error('APP_PASSWORD and SESSION_SECRET are required in production.');
    process.exit(1);
  }
  console.warn('WARNING: APP_PASSWORD/SESSION_SECRET not set; authentication is disabled (local dev only).');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders(isProduction));
app.use(requestTracker);
if (isProduction) app.use(requireHttps);
app.use('/vendor', express.static(path.join(__dirname, 'public', 'vendor')));
if (authEnabled) {
  const auth = createAuth({
    password: process.env.APP_PASSWORD,
    secret: process.env.SESSION_SECRET,
    ttlMs: Number(process.env.SESSION_TTL_MS) || undefined,
    secure: isProduction
  });
  app.use(auth.router);
  app.use(auth.requireAuth);
}
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', reportRoutes);
app.use('/api', storeRoutes);
app.use('/api', usageRoutes);
app.use('/api', diagnosticsRoutes);

process.on('unhandledRejection', (reason) => {
  logError('process.unhandledRejection', reason, {});
});

process.on('uncaughtException', (err) => {
  logError('process.uncaughtException', err, {});
});

const HOST = process.env.HOST || (isProduction || process.env.DYNO ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, () => logInfo('server.start', `Server listening on ${HOST}:${PORT}`, { port: PORT, auth: authEnabled }));
