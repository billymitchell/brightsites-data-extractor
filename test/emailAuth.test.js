const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { start, request } = require('./helpers/http');
const { createEmailAuth, normalizeCompanyEmail } = require('../middleware/emailAuth');
const { createAuth } = require('../middleware/auth');
const { getAuthConfig } = require('../config/auth');

const secret = 'email-auth-test-secret-at-least-32-characters';
const email = 'person@centricitynow.com';
const takeCookie = (response, name) => response.headers['set-cookie'].find(value => value.startsWith(`${name}=`)).split(';')[0];

async function fixture(options = {}) {
  const sent = [];
  const verified = [];
  const provider = options.provider || {
    async sendCode(address) { sent.push(address); },
    async verifyCode(address, code) {
      verified.push({ address, code });
      if (code !== '123456') throw Object.assign(new Error('Incorrect or expired code.'), { statusCode: 401 });
      return { email: address, emailConfirmed: true };
    },
  };
  const auth = createEmailAuth({ secret, provider, ...options });
  const app = express();
  app.use(auth.router);
  app.use(auth.requireAuth);
  app.get('/', (req, res) => res.send('Reports'));
  app.get('/api/private', (req, res) => res.json(req.auth));
  app.post('/api/private', (req, res) => res.json(req.auth));
  const server = await start(app);
  return { server, sent, verified };
}

async function form(server, path, fields = {}, cookie, headers = {}) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(new URLSearchParams(fields).toString());
  });
}

test('company email normalization requires the exact domain and a valid local part', () => {
  assert.equal(normalizeCompanyEmail(' Person+Reports@CENTRICITYNOW.COM '), 'person+reports@centricitynow.com');
  for (const value of [undefined, [], {}, '', 'person@example.com', 'person@evilcentricitynow.com',
    'person@centricitynow.com.evil.test', 'person@sub.centricitynow.com', 'a@@centricitynow.com',
    'a b@centricitynow.com', '.person@centricitynow.com', 'a..b@centricitynow.com',
    'a.@centricitynow.com', 'a\n@centricitynow.com', `${'a'.repeat(65)}@centricitynow.com`]) {
    assert.equal(normalizeCompanyEmail(value), null, String(value));
  }
});

test('email configuration fails closed and never falls back to the shared password', () => {
  assert.equal(getAuthConfig({}).enabled, false);
  assert.throws(() => getAuthConfig({ AUTH_MODE: 'unknown' }), /AUTH_MODE/);
  assert.throws(() => getAuthConfig({ NODE_ENV: 'production' }), /APP_PASSWORD/);
  const base = { AUTH_MODE: 'email', SESSION_SECRET: secret, SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' };
  assert.equal(getAuthConfig(base).enabled, true);
  assert.equal(getAuthConfig({ ...base, APP_PASSWORD: 'legacy' }).mode, 'email');
  for (const key of ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
    assert.throws(() => getAuthConfig({ ...base, [key]: '' }));
  }
  for (const url of ['http://project.supabase.co', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1']) {
    assert.throws(() => getAuthConfig({ ...base, SUPABASE_URL: url }), /SUPABASE_URL/);
  }
  for (const value of ['0', '-1', 'NaN', '1.5', 'Infinity']) {
    assert.throws(() => getAuthConfig({ ...base, SESSION_TTL_MS: value }), /SESSION_TTL_MS/);
  }
});

test('email-code flow issues a secure session only after verification and clears cookies on logout', async () => {
  let time = 1000;
  const { server, sent, verified } = await fixture({ secure: true, ttlMs: 2000, now: () => time });
  try {
    assert.equal((await request(server, '/api/private')).status, 401);
    assert.equal((await request(server, '/')).headers.location, '/login');
    const login = await request(server, '/login');
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.doesNotMatch(login.body, /name="password"/);
    const browserHeaders = { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' };
    const send = await form(server, '/login', { email: ' Person@CentricityNow.com ' }, undefined, browserHeaders);
    assert.equal(send.status, 302);
    assert.equal(send.headers.location, '/login/verify');
    assert.deepEqual(sent, [email]);
    const pending = takeCookie(send, 'bs_email_pending');
    assert.equal((await request(server, '/api/private', { headers: { Cookie: pending } })).status, 401);
    const verifyPage = await request(server, '/login/verify', { headers: { Cookie: pending } });
    assert.equal(verifyPage.status, 200);
    assert.equal(verifyPage.headers['cache-control'], 'no-store');
    const verify = await form(server, '/login/verify', { code: '123456' }, pending, browserHeaders);
    assert.equal(verify.status, 302);
    assert.deepEqual(verified, [{ address: email, code: '123456' }]);
    assert.match(verify.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Secure/);
    const session = takeCookie(verify, 'bs_email_session');
    const authenticated = await request(server, '/api/private', { headers: { Cookie: session } });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(JSON.parse(authenticated.body), { email });
    assert.equal((await request(server, '/api/private', { headers: { Cookie: `${session}x` } })).status, 401);
    assert.equal((await form(server, '/logout', {}, session, { Origin: 'https://evil.test' })).status, 403);
    const logout = await form(server, '/logout', {}, session, { Accept: 'application/json' });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers['set-cookie'].every(value => value.includes('Max-Age=0')));
    const browserLogout = await form(server, '/logout', {}, session, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    assert.equal(browserLogout.status, 302);
    assert.equal(browserLogout.headers.location, '/login');
    time += 2001;
    assert.equal((await request(server, '/api/private', { headers: { Cookie: session } })).status, 401);
  } finally { server.close(); }
});

test('invalid input, cross-origin requests, forged pending cookies, and legacy sessions cannot authenticate', async () => {
  const { server, sent, verified } = await fixture();
  try {
    assert.equal((await form(server, '/login', { email: 'person@centricitynow.com.evil.test' })).status, 400);
    assert.equal((await form(server, '/login', { email }, undefined, { Origin: 'https://evil.test', 'Sec-Fetch-Site': 'same-origin' })).status, 403);
    assert.equal((await form(server, '/login', { email }, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await form(server, '/login', { email }, undefined, { Origin: 'null' })).status, 403);
    assert.equal((await form(server, '/login', { email }, undefined, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.deepEqual(sent, []);
    assert.equal((await form(server, '/login/verify', { code: '123456' })).status, 401);
    assert.equal((await form(server, '/login/verify', { code: '123456' }, 'bs_email_pending=forged')).status, 401);
    assert.deepEqual(verified, []);
    const legacy = createAuth({ password: 'legacy', secret });
    const app = express();
    app.use(legacy.router);
    const legacyServer = await start(app);
    try {
      const passwordLogin = await form(legacyServer, '/login', { password: 'legacy' });
      const cookie = takeCookie(passwordLogin, 'bs_session');
      assert.equal((await request(server, '/api/private', { headers: { Cookie: cookie } })).status, 401);
    } finally { legacyServer.close(); }
  } finally { server.close(); }
});

test('verification rejects wrong codes, pending tokens used as sessions, and expired requests', async () => {
  let time = 0;
  const { server } = await fixture({ now: () => time });
  try {
    const pending = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
    assert.equal((await form(server, '/login/verify', { code: 'abc' }, pending)).status, 400);
    assert.equal((await form(server, '/login/verify', { code: '000000' }, pending)).status, 401);
    assert.equal((await request(server, '/api/private', { headers: { Cookie: pending.replace('bs_email_pending', 'bs_email_session') } })).status, 401);
    time += 10 * 60 * 1000;
    assert.equal((await form(server, '/login/verify', { code: '123456' }, pending)).status, 401);
    assert.equal((await request(server, '/login/verify', { headers: { Cookie: pending } })).headers.location, '/login');
  } finally { server.close(); }
});

test('Supabase must return a verified company email matching the requested address', async () => {
  for (const user of [{ email, emailConfirmed: false }, { email: 'other@centricitynow.com', emailConfirmed: true },
    { email: 'person@example.com', emailConfirmed: true }, null]) {
    const { server } = await fixture({ provider: { async sendCode() {}, async verifyCode() { return user; } } });
    try {
      const pending = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
      const response = await form(server, '/login/verify', { code: '123456' }, pending);
      assert.equal(response.status, 403);
      assert.equal(response.headers['set-cookie'], undefined);
    } finally { server.close(); }
  }
});

test('code sending and verification are independently rate-limited per email with window expiry', async () => {
  let time = 0;
  const { server, sent, verified } = await fixture({ now: () => time });
  try {
    let pending;
    for (let i = 0; i < 3; i++) pending = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
    assert.equal((await form(server, '/login', { email })).status, 429);
    assert.equal(sent.length, 3);
    for (let i = 0; i < 5; i++) assert.equal((await form(server, '/login/verify', { code: '000000' }, pending)).status, 401);
    assert.equal((await form(server, '/login/verify', { code: '123456' }, pending)).status, 429);
    assert.equal(verified.length, 5);
    time += 15 * 60 * 1000;
    const fresh = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
    assert.equal((await form(server, '/login/verify', { code: '123456' }, fresh)).status, 302);
  } finally { server.close(); }
});

test('colleagues can sign in from one IP while excessive requests are throttled', async () => {
  const { server, sent } = await fixture();
  try {
    for (let i = 0; i < 20; i++) {
      assert.equal((await form(server, '/login', { email: `person${i}@centricitynow.com` })).status, 302);
    }
    assert.equal((await form(server, '/login', { email: 'another@centricitynow.com' })).status, 429);
    assert.equal(sent.length, 20);
  } finally { server.close(); }
});

test('a verification code cannot be reused after the provider consumes it', async () => {
  let used = false;
  const { server } = await fixture({ provider: {
    async sendCode() {},
    async verifyCode(address) {
      if (used) throw Object.assign(new Error('Incorrect or expired code.'), { statusCode: 401 });
      used = true;
      return { email: address, emailConfirmed: true };
    },
  } });
  try {
    const pending = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
    assert.equal((await form(server, '/login/verify', { code: '123456' }, pending)).status, 302);
    const replay = await form(server, '/login/verify', { code: '123456' }, pending);
    assert.equal(replay.status, 401);
    assert.equal(replay.headers['set-cookie'], undefined);
  } finally { server.close(); }
});

test('delivery failures are visible and do not create pending or authenticated cookies', async () => {
  const { server } = await fixture({ provider: { async sendCode() { throw new Error('delivery unavailable'); } } });
  try {
    const response = await form(server, '/login', { email });
    assert.equal(response.status, 503);
    assert.match(response.body, /unavailable/);
    assert.equal(response.headers['set-cookie'], undefined);
  } finally { server.close(); }
});

test('authenticated state-changing API requests reject cross-origin requests', async () => {
  const { server } = await fixture();
  try {
    const pending = takeCookie(await form(server, '/login', { email }), 'bs_email_pending');
    const session = takeCookie(await form(server, '/login/verify', { code: '123456' }, pending), 'bs_email_session');
    assert.equal((await form(server, '/api/private', {}, session)).status, 200);
    assert.equal((await form(server, '/api/private', {}, session, { Origin: 'https://evil.test' })).status, 403);
  } finally { server.close(); }
});
