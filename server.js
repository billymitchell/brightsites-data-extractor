const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const { PORT } = require('./config/report');
const reportRoutes = require('./routes/reportRoutes');
const storeRoutes = require('./routes/storeRoutes');
const usageRoutes = require('./routes/usageRoutes');
const { logError, logInfo } = require('./utils/logger');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', reportRoutes);
app.use('/api', storeRoutes);
app.use('/api', usageRoutes);

process.on('unhandledRejection', (reason) => {
  logError('process.unhandledRejection', reason, {});
});

process.on('uncaughtException', (err) => {
  logError('process.uncaughtException', err, {});
});

app.listen(PORT, () => logInfo('server.start', `Server listening on http://localhost:${PORT}`, { port: PORT }));
