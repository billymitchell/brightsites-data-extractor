const os = require('os');

const usage = require('../lib/usage');
const { getConfiguredStores } = require('../config/stores');
const { getJobHistory } = require('./reportJobService');
const { getRecentEntries } = require('../utils/logger');

const startedAt = new Date();
const requestStats = { total: 0, byStatus: {}, slow: 0 };

function requestTracker(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  const began = Date.now();
  res.on('finish', () => {
    requestStats.total += 1;
    const bucket = `${Math.floor(res.statusCode / 100)}xx`;
    requestStats.byStatus[bucket] = (requestStats.byStatus[bucket] || 0) + 1;
    if (Date.now() - began > 5000) requestStats.slow += 1;
  });
  return next();
}

function formatDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function collect() {
  const month = usage.monthKey();
  const monthData = usage.getMonth(month);
  const stores = getConfiguredStores();
  const jobs = getJobHistory();
  const entries = getRecentEntries();
  const problems = entries.filter((e) => e.level === 'error' || e.level === 'warn');
  return {
    generatedAt: new Date().toISOString(),
    app: {
      startedAt: startedAt.toISOString(),
      uptime: formatDuration(Date.now() - startedAt.getTime()),
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      environment: process.env.NODE_ENV || 'development',
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    },
    stores: Object.keys(stores).map((key) => ({
      key,
      label: stores[key].label || key,
      apiCallsThisMonth: monthData[key] || 0,
    })),
    month,
    requests: requestStats,
    jobs,
    problems,
    recentLog: entries.slice(-100),
  };
}

function plainSummary(d) {
  const lines = [];
  const add = (s = '') => lines.push(s);
  add('BRIGHTSITES EXPORTER - SUPPORT REPORT');
  add(`Created: ${d.generatedAt}`);
  add('Please send this whole file when asking for help.');
  add();
  add('== QUICK SUMMARY ==');
  const failed = d.jobs.filter((j) => j.status === 'failed').length;
  add(`Reports run since last restart: ${d.jobs.length} (${d.jobs.filter((j) => j.status === 'completed').length} OK, ${failed} failed, ${d.jobs.filter((j) => j.status === 'canceled').length} canceled)`);
  add(`Warnings/errors logged: ${d.problems.length}`);
  add(`App running for: ${d.app.uptime} (since ${d.app.startedAt})`);
  add('Note: history resets whenever the app restarts or redeploys.');
  add();
  add('== RECENT REPORTS (newest last) ==');
  if (!d.jobs.length) add('(none yet)');
  d.jobs.forEach((j) => {
    add(`- ${j.createdAt} | ${j.status.toUpperCase()} | store: ${j.storeKey} | ${j.start} to ${j.end} | status filter: ${j.statusFilter || 'all'} | orders: ${j.orders ?? '-'} | rows: ${j.rows ?? '-'} | took: ${j.durationSec ?? '-'}s${j.error ? ` | ERROR: ${j.error}` : ''}`);
  });
  add();
  add(`== BRIGHTSITES API CALLS THIS MONTH (${d.month}) ==`);
  d.stores.forEach((s) => add(`- ${s.label}: ${s.apiCallsThisMonth}`));
  add();
  add('== WEB REQUESTS ==');
  add(`Total: ${d.requests.total} | by result: ${JSON.stringify(d.requests.byStatus)} | slow (>5s): ${d.requests.slow}`);
  add();
  add('== WARNINGS AND ERRORS ==');
  if (!d.problems.length) add('(none)');
  d.problems.slice(-50).forEach((e) => add(`- ${e.timestamp} [${e.level}] ${e.scope}: ${e.message}`));
  add();
  add('== TECHNICAL DETAILS ==');
  add(JSON.stringify(d.app));
  add();
  add('== RECENT LOG (last 100 events, secrets hidden) ==');
  d.recentLog.forEach((e) => add(`${e.timestamp} ${String(e.level).toUpperCase()} ${e.scope}: ${e.message} ${e.meta && Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''}`));
  return lines.join('\n');
}

module.exports = { requestTracker, collect, plainSummary };
