const crypto = require('crypto');
const express = require('express');
const { parseCookies, safeEqual, sameOrigin } = require('./authHelpers');
const { logError } = require('../utils/logger');

const SESSION_COOKIE = 'bs_email_session';
const PENDING_COOKIE = 'bs_email_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

function normalizeCompanyEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && email.indexOf('@') <= 64 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@centricitynow\.com$/.test(email)
    && !email.startsWith('.') && !email.includes('..') && !email.includes('.@') ? email : null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function createLimiter(max, now) {
  const entries = new Map();
  return key => {
    for (const [identifier, entry] of entries) {
      if (now() - entry.start >= WINDOW_MS) entries.delete(identifier);
    }
    const entry = entries.get(key);
    if (entry) {
      if (entry.count >= max) return false;
      entry.count++;
    } else {
      if (entries.size >= 10000) return false;
      entries.set(key, { start: now(), count: 1 });
    }
    return true;
  };
}

function createEmailAuth({ provider, secret, secure = false, ttlMs = 8 * 3600 * 1000, now = () => Date.now() }) {
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  const allowSendIp = createLimiter(20, now);
  const allowSendEmail = createLimiter(3, now);
  const allowVerifyIp = createLimiter(50, now);
  const allowVerifyEmail = createLimiter(5, now);
  const signature = (purpose, payload) => crypto.createHmac('sha256', secret).update(`${purpose}.${payload}`).digest('hex');
  function sign(purpose, email, duration) {
    const payload = Buffer.from(JSON.stringify({ email, exp: now() + duration })).toString('base64url');
    return `${payload}.${signature(purpose, payload)}`;
  }
  function read(req, purpose) {
    const token = parseCookies(req.headers.cookie)[purpose];
    if (!token || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !safeEqual(parts[1], signature(purpose, parts[0]))) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
    if (!payload || !Number.isSafeInteger(payload.exp) || payload.exp <= now()) return null;
    const email = normalizeCompanyEmail(payload.email);
    return email === payload.email ? email : null;
  }
  const cookie = (purpose, email, duration) => `${purpose}=${sign(purpose, email, duration)}; ${attrs}; Max-Age=${Math.floor(duration / 1000)}`;
  const clearCookie = purpose => `${purpose}=; ${attrs}; Max-Age=0`;
  const isAuthed = req => Boolean(read(req, SESSION_COOKIE));
  function page(message = '', email = null) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/pico.min.css"></head>
<body><main class="container" style="max-width:460px;margin-top:12vh"><article>
<h2>BrightSites Reports</h2><p>Sign in with your @centricitynow.com email.</p>
${message ? `<p role="alert">${escapeHtml(message)}</p>` : ''}
${email ? `<p>A sign-in code was sent to <strong>${escapeHtml(email)}</strong>. Check your inbox and spam folder.</p>
<form method="post" action="/login/verify">
<label for="code">Email code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" autofocus required>
<button type="submit">Verify and sign in</button></form>
<p><a href="/login">Request a new code or use another email</a></p>` : `<form method="post" action="/login">
<label for="email">Company email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@centricitynow.com" maxlength="254" autofocus required>
<button type="submit">Send sign-in code</button></form>`}
</article></main></body></html>`;
  }
  function serviceError(res, error, email = null) {
    logError('middleware.emailAuth', error);
    const status = [401, 429, 502, 503].includes(error.statusCode) ? error.statusCode : 503;
    const message = status === error.statusCode ? error.message : 'Email sign-in is unavailable. Please try again later.';
    return res.status(status).type('html').send(page(message, email));
  }
  const router = express.Router();
  router.use(['/login', '/logout'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/login', (req, res) => res.type('html').send(page()));
  router.get('/login/verify', (req, res) => {
    const email = read(req, PENDING_COOKIE);
    return email ? res.type('html').send(page('', email)) : res.redirect('/login');
  });
  router.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (!allowSendIp(req.ip)) return res.status(429).type('html').send(page('Too many code requests. Try again in 15 minutes.'));
    const email = normalizeCompanyEmail(req.body && req.body.email);
    if (!email) return res.status(400).type('html').send(page('Enter a valid @centricitynow.com email address.'));
    if (!allowSendEmail(email)) return res.status(429).type('html').send(page('Too many code requests for this email. Try again in 15 minutes.'));
    try {
      await provider.sendCode(email);
      res.setHeader('Set-Cookie', cookie(PENDING_COOKIE, email, PENDING_TTL_MS));
      return res.redirect('/login/verify');
    } catch (error) {
      return serviceError(res, error);
    }
  });
  router.post('/login/verify', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (!allowVerifyIp(req.ip)) return res.status(429).type('html').send(page('Too many verification attempts. Try again in 15 minutes.'));
    const email = read(req, PENDING_COOKIE);
    if (!email) return res.status(401).type('html').send(page('Your sign-in request expired. Please request a new code.'));
    if (!allowVerifyEmail(email)) return res.status(429).type('html').send(page('Too many verification attempts for this email. Try again in 15 minutes.'));
    const code = req.body && typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6,10}$/.test(code)) return res.status(400).type('html').send(page('Enter the numeric code from your email.', email));
    try {
      const user = await provider.verifyCode(email, code);
      if (!user || user.emailConfirmed !== true || normalizeCompanyEmail(user.email) !== email) {
        return res.status(403).type('html').send(page('Access requires a verified @centricitynow.com email matching your sign-in request.'));
      }
      res.setHeader('Set-Cookie', [cookie(SESSION_COOKIE, email, ttlMs), clearCookie(PENDING_COOKIE)]);
      return res.redirect('/');
    } catch (error) {
      return serviceError(res, error, email);
    }
  });
  router.post('/logout', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    res.setHeader('Set-Cookie', [clearCookie(SESSION_COOKIE), clearCookie(PENDING_COOKIE)]);
    if (req.accepts(['html', 'json']) === 'html') return res.redirect('/login');
    return res.json({ ok: true });
  });
  function requireAuth(req, res, next) {
    const email = read(req, SESSION_COOKIE);
    if (!email) {
      if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Authentication required' });
      return res.redirect('/login');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
    req.auth = { email };
    return next();
  }
  return { router, requireAuth, isAuthed };
}

module.exports = { createEmailAuth, normalizeCompanyEmail };
