const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ExcelJS = require('exceljs');
const { start, request } = require('./helpers/http');
const { createAuth } = require('../middleware/auth');
const jobs = require('../services/reportJobService');
const fixture = { columns: ['Order #'], rows: [['00100']], rowDetails: [{}], rowKeys: ['shop:100'] };
let payload;
jobs.getJobResult = () => payload;
require('../utils/logger').logError = () => {};
const router = require('../routes/reportRoutes');
async function appServer(t, authenticated = true) {
  const app = express(); app.use(express.json());
  if (!authenticated) app.use(createAuth({ password: 'pw', secret: 'test-secret' }).requireAuth);
  app.use('/api', router);
  const server = await start(app); t.after(() => server.close()); return server;
}
test('completed paired jobs download an XLSX attachment from server-held rows', async t => {
  const server = await appServer(t);
  payload = { job: { status: 'completed', request: { reportLevel: 'both' } }, result: { tables: { order: fixture, shipment: fixture }, meta: { reportLevel: 'both' } } };
  const response = await request(server, '/api/run/fixture/workbook', { method: 'POST', body: { selections: { order: { columns: [] } } } });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /spreadsheetml/);
  assert.match(response.headers['content-disposition'], /brightsites_orders_and_shipments.xlsx/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(response.buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.getWorksheet('Order Level').getCell('A2').value, 'shop:100');
  assert.equal((await request(server, '/api/run/fixture/workbook', { method: 'POST', body: { rows: [['injected']] } })).status, 400);
});
test('download endpoint preserves job errors, selection validation and authentication', async t => {
  const server = await appServer(t);
  for (const [status, result, expected] of [ ['running', null, 409], ['canceled', null, 409], ['failed', null, 500], ['completed', null, 410] ]) {
    payload = { job: { status, error: 'fixture error', request: { reportLevel: 'both' } }, result };
    assert.equal((await request(server, '/api/run/fixture/workbook', { method: 'POST' })).status, expected);
  }
  payload = null;
  assert.equal((await request(server, '/api/run/missing/workbook', { method: 'POST' })).status, 404);
  payload = { job: { status: 'completed' }, result: { ...fixture, meta: { reportLevel: 'shipment' } } };
  assert.equal((await request(server, '/api/run/fixture/workbook', { method: 'POST' })).status, 400);
  const protectedServer = await appServer(t, false);
  assert.equal((await request(protectedServer, '/api/run/fixture/workbook', { method: 'POST' })).status, 401);
});
