function getAuthConfig(env = process.env) {
  const mode = env.AUTH_MODE || 'password';
  if (!['password', 'email'].includes(mode)) throw new Error('AUTH_MODE must be password or email.');
  const secure = env.NODE_ENV === 'production';
  const ttlMs = env.SESSION_TTL_MS === undefined ? 8 * 3600 * 1000 : Number(env.SESSION_TTL_MS);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new Error('SESSION_TTL_MS must be an integer of at least 1000.');

  if (mode === 'email') {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      throw new Error('Email authentication requires SESSION_SECRET with at least 32 characters.');
    }
    let url;
    try { url = new URL(env.SUPABASE_URL); } catch {
      throw new Error('Email authentication requires a valid HTTPS SUPABASE_URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('SUPABASE_URL must be an HTTPS project origin without credentials, paths, or query parameters.');
    }
    if (!env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Email authentication requires SUPABASE_PUBLISHABLE_KEY.');
    return { enabled: true, mode, secure, ttlMs, secret: env.SESSION_SECRET,
      supabaseUrl: url.origin, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY };
  }

  const enabled = Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
  if (!enabled && secure) throw new Error('APP_PASSWORD and SESSION_SECRET are required in production when AUTH_MODE=password.');
  return { enabled, mode, secure, ttlMs, secret: env.SESSION_SECRET, password: env.APP_PASSWORD };
}

module.exports = { getAuthConfig };
