const crypto = require('crypto');
const express = require('express');
const { safeEqual, parseCookies, sameOrigin } = require('./authHelpers');

const COOKIE = 'bs_session';
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function sha(v) { return crypto.createHash('sha256').update(String(v)).digest(); }
function hmac(secret, v) { return crypto.createHmac('sha256', secret).update(v).digest('hex'); }

function createAuth({ password, secret, ttlMs = 8 * 3600 * 1000, secure = false, now = () => Date.now() }) {
  const fails = new Map();

  const sign = () => {
    const exp = String(now() + ttlMs);
    return `${exp}.${hmac(secret, exp)}`;
  };
  const valid = (token) => {
    if (!token) return false;
    const [exp, sig] = String(token).split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    return safeEqual(sig, hmac(secret, exp)) && Number(exp) > now();
  };
  const isAuthed = (req) => valid(parseCookies(req.headers.cookie)[COOKIE]);

  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

  function throttled(ip) {
    const e = fails.get(ip);
    if (!e) return false;
    if (now() - e.first > WINDOW_MS) { fails.delete(ip); return false; }
    return e.count >= MAX_FAILS;
  }
  function recordFail(ip) {
    const e = fails.get(ip);
    if (!e || now() - e.first > WINDOW_MS) fails.set(ip, { first: now(), count: 1 });
    else e.count += 1;
  }

  const page = (msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/pico.min.css"></head>
<body><main class="container" style="max-width:420px;margin-top:15vh"><article>
<h2>BrightSites Reports</h2>${msg ? `<p role="alert"><mark>${msg}</mark></p>` : ''}
<form method="post" action="/login"><input type="password" name="password" placeholder="Password" autofocus required>
<button type="submit">Sign in</button></form></article></main></body></html>`;

  const router = express.Router();
  router.get('/login', (req, res) => res.type('html').send(page('')));
  router.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (throttled(req.ip)) return res.status(429).type('html').send(page('Too many attempts. Try again later.'));
    const ok = crypto.timingSafeEqual(sha(req.body && req.body.password), sha(password));
    if (!ok) { recordFail(req.ip); return res.status(401).type('html').send(page('Incorrect password.')); }
    fails.delete(req.ip);
    res.setHeader('Set-Cookie', `${COOKIE}=${sign()}; ${cookieAttrs}; Max-Age=${Math.floor(ttlMs / 1000)}`);
    res.redirect('/');
  });
  router.post('/logout', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs}; Max-Age=0`);
    if (req.accepts('html') && !req.accepts('json')) return res.redirect('/login');
    res.json({ ok: true });
  });

  function requireAuth(req, res, next) {
    if (!isAuthed(req)) {
      if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Authentication required' });
      return res.redirect('/login');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
    next();
  }

  return { router, requireAuth, isAuthed };
}

module.exports = { createAuth };
