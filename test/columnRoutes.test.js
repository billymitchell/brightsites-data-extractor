const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { start, request } = require('./helpers/http');
test('column route selects a concrete schema and rejects invalid levels', async t => {
  const app = express();
  app.use('/api', require('../routes/storeRoutes'));
  const srv = await start(app);
  t.after(() => srv.close());
  const order = await request(srv, '/api/columns?reportLevel=order');
  assert.equal(order.status, 200);
  assert.ok(JSON.parse(order.body).core.includes('Unique Item Count'));
  const shipment = await request(srv, '/api/columns');
  assert.ok(JSON.parse(shipment.body).core.includes('Line Item ID'));
  for (const level of ['both', 'invalid', '']) assert.equal((await request(srv, `/api/columns?reportLevel=${level}`)).status, 400);
});
