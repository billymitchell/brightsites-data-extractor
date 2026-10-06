function securityHeaders(isProduction) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'");
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    if (req.path.startsWith('/api') || req.path === '/login') res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

function requireHttps(req, res, next) {
  if (req.secure) return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return res.status(403).json({ error: 'HTTPS required' });
}

module.exports = { securityHeaders, requireHttps };
