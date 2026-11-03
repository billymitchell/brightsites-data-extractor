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
const { createEmailAuth } = require('./middleware/emailAuth');
const { createEmailAuthProvider } = require('./lib/emailAuth');
const { getAuthConfig } = require('./config/auth');
const { securityHeaders, requireHttps } = require('./middleware/security');

const isProduction = process.env.NODE_ENV === 'production';
let authConfig;
try {
  authConfig = getAuthConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const authEnabled = authConfig.enabled;
if (!authEnabled) {
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
  const auth = authConfig.mode === 'email'
    ? createEmailAuth({
      ...authConfig,
      provider: createEmailAuthProvider({ url: authConfig.supabaseUrl, key: authConfig.supabaseKey }),
    })
    : createAuth(authConfig);
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
