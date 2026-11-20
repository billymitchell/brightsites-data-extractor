const crypto = require('crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  });
  return out;
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  // Referrer-Policy: no-referrer can make a same-origin form POST use an opaque Origin.
  if (origin === 'null') return site === 'same-origin';
  try {
    return new URL(origin).origin === `${req.protocol}://${req.headers.host}`;
  } catch {
    return false;
  }
}

module.exports = { safeEqual, parseCookies, sameOrigin };
