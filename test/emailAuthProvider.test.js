const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailAuthProvider } = require('../lib/emailAuth');

const url = 'https://project.supabase.co';
const key = 'test-publishable-key';
const email = 'person@centricitynow.com';
const response = (body, status = 200) => ({ ok: status < 400, status, async json() { return body; } });

test('Supabase sends email OTPs and verifies identity using the returned access token', async () => {
  const calls = [];
  const provider = createEmailAuthProvider({ url, key, fetchImpl: async (target, options) => {
    calls.push({ target, options });
    if (target.endsWith('/otp')) return response({});
    if (target.endsWith('/verify')) return response({ access_token: 'verified-access-token' });
    return response({ email, email_confirmed_at: '2026-11-03T17:00:00Z' });
  } });
  await provider.sendCode(email);
  assert.deepEqual(JSON.parse(calls[0].options.body), { email, create_user: true });
  assert.equal(calls[0].target, `${url}/auth/v1/otp`);
  assert.deepEqual(await provider.verifyCode(email, '123456'), { email, emailConfirmed: true });
  assert.deepEqual(JSON.parse(calls[1].options.body), { email, token: '123456', type: 'email' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer verified-access-token');
  assert.equal(calls[2].target, `${url}/auth/v1/user`);
  assert.ok(calls.every(call => call.options.timeout === 15000 && call.options.headers.apikey === key));
});

test('OTP failures, rate limits, delivery failures and outages return controlled errors', async () => {
  for (const [status, expected] of [[400, 401], [401, 401], [403, 401], [422, 401], [429, 429], [500, 502]]) {
    const provider = createEmailAuthProvider({ url, key, fetchImpl: async () => response({ secret: 'must-not-leak' }, status) });
    await assert.rejects(provider.verifyCode(email, '123456'), error => error.statusCode === expected && !error.message.includes('must-not-leak'));
  }
  const provider = createEmailAuthProvider({ url, key, fetchImpl: async () => { throw new Error('internal credentials must-not-leak'); } });
  await assert.rejects(provider.sendCode(email), { statusCode: 503 });
});

test('missing tokens and malformed upstream responses never produce a user', async () => {
  const missing = createEmailAuthProvider({ url, key, fetchImpl: async () => response({}) });
  await assert.rejects(missing.verifyCode(email, '123456'), { statusCode: 502 });
  const malformed = createEmailAuthProvider({ url, key, fetchImpl: async () => ({ ok: true, async json() { throw new Error('bad json'); } }) });
  await assert.rejects(malformed.sendCode(email), { statusCode: 502 });
});
