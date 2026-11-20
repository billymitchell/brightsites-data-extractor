const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, '..', 'server.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
// node --test sets NODE_TEST_CONTEXT; keep test fixtures out of the real support log.
const WRITE_FILE = !process.env.NODE_TEST_CONTEXT;
const BUFFER_SIZE = 500;

function rotateIfLarge() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (e) { /* missing file or rotation failure: keep appending */ }
}
if (WRITE_FILE) rotateIfLarge();
const recent = [];
const SENSITIVE_KEY = /token|password|secret|authorization|cookie/i;

function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return redact(serializeError(value), depth + 1);
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
    meta: redact(meta),
  };
  const line = `${safeStringify(entry)}\n`;
  try {
    recent.push(JSON.parse(line));
    if (recent.length > BUFFER_SIZE) recent.shift();
  } catch (e) { /* buffer is best-effort */ }

  if (WRITE_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch (err) {
      const fallback = `[${timestamp}] LOGGER_FAILURE ${err.message}`;
      console.error(fallback);
    }
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
