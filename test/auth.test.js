const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { createAuth } = require('../middleware/auth');

function start(opts = {}) {
  const auth = createAuth({ password: 'pw', secret: 's3cret', ...opts });
  const app = express();
  app.use(auth.router);
  app.use(auth.requireAuth);
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  return new Promise((r) => { const srv = app.listen(0, '127.0.0.1', () => r(srv)); });
}
function req(srv, path, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port: srv.address().port, path, method, headers: {
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { Cookie: cookie } : {}) } },
    (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

test('auth flow', async () => {
  const srv = await start();
  try {
    assert.strictEqual((await req(srv, '/api/x')).status, 401);
    assert.strictEqual((await req(srv, '/')).status, 302);
    assert.strictEqual((await req(srv, '/login', { method: 'POST', body: 'password=bad' })).status, 401);
    const ok = await req(srv, '/login', { method: 'POST', body: 'password=pw' });
    assert.strictEqual(ok.status, 302);
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    assert.strictEqual((await req(srv, '/api/x', { cookie })).status, 200);
    assert.strictEqual((await req(srv, '/api/x', { cookie: cookie + 'x' })).status, 401);
  } finally { srv.close(); }
});

test('throttles repeated failures and expires sessions', async () => {
  let t = 1000;
  const srv = await start({ now: () => t, ttlMs: 1000 });
  try {
    for (let i = 0; i < 5; i++) await req(srv, '/login', { method: 'POST', body: 'password=bad' });
    assert.strictEqual((await req(srv, '/login', { method: 'POST', body: 'password=pw' })).status, 429);
    t += 16 * 60 * 1000;
    const ok = await req(srv, '/login', { method: 'POST', body: 'password=pw' });
    assert.strictEqual(ok.status, 302);
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    t += 2000;
    assert.strictEqual((await req(srv, '/api/x', { cookie })).status, 401);
  } finally { srv.close(); }
});
