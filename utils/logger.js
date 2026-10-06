const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'server.log');
const BUFFER_SIZE = 500;
const recent = [];
const SENSITIVE_KEY = /token|password|secret|authorization|cookie/i;

function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  Object.keys(value).forEach((k) => {
    out[k] = SENSITIVE_KEY.test(k) ? '[hidden]' : redact(value[k], depth + 1);
  });
  return out;
}

function getRecentEntries(limit = BUFFER_SIZE) {
  return recent.slice(-limit);
}

function serializeError(err) {
  if (!err) return null;
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, current) => {
        if (current instanceof Error) return serializeError(current);
        if (typeof current === 'object' && current !== null) {
          if (seen.has(current)) return '[Circular]';
          seen.add(current);
        }
        return current;
      }
    );
  } catch (err) {
    return JSON.stringify({
      serializationError: err.message,
      fallbackType: typeof value,
    });
  }
}

function write(level, scope, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    scope,
    message,
    meta,
  };
  const line = `${safeStringify(entry)}\n`;
  try {
    recent.push(JSON.parse(safeStringify(Object.assign({}, entry, { meta: redact(meta) }))));
    if (recent.length > BUFFER_SIZE) recent.shift();
  } catch (e) { /* buffer is best-effort */ }

  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    const fallback = `[${timestamp}] LOGGER_FAILURE ${err.message}`;
    console.error(fallback);
  }

  const printer = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
  printer(`[${timestamp}] ${level.toUpperCase()} ${scope}: ${message}`);
}

function logInfo(scope, message, meta = {}) {
  write('info', scope, message, meta);
}

function logWarn(scope, message, meta = {}) {
  write('warn', scope, message, meta);
}

function logError(scope, err, meta = {}) {
  const error = serializeError(err);
  const message = error && error.message ? error.message : String(err);
  write('error', scope, message, Object.assign({}, meta, { error }));
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  getRecentEntries,
};
