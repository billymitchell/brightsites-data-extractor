// Report dates are business dates in one store timezone, not the server's local zone (UTC on Heroku).
const DEFAULT_TIMEZONE = 'America/New_York';

function resolveTimezone(value) {
  const zone = value || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`REPORT_TIMEZONE '${zone}' is not a valid IANA timezone (for example America/New_York).`);
  }
}

const REPORT_TIMEZONE = resolveTimezone(process.env.REPORT_TIMEZONE);
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

function zonedParts(date, timeZone = REPORT_TIMEZONE) {
  const parts = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) parts[type] = value;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function offsetMs(utcMs, timeZone) {
  const whole = utcMs - (((utcMs % 1000) + 1000) % 1000);
  const p = zonedParts(new Date(whole), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

// Converts a wall-clock time in `timeZone` to a UTC Date, handling DST transitions.
function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, timeZone = REPORT_TIMEZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const approx = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(approx, timeZone));
}

const pad = n => String(n).padStart(2, '0');

// Parses 'YYYY-MM-DD' into calendar parts, or null when it is not a real calendar date.
function parseDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

// First and last instant of a business day in the report timezone.
function dayStartUtc(dateOnly, timeZone = REPORT_TIMEZONE) {
  const p = parseDateOnly(dateOnly);
  return p ? zonedTimeToUtc(p, timeZone) : new Date(NaN);
}
function dayEndUtc(dateOnly, timeZone = REPORT_TIMEZONE) {
  const p = parseDateOnly(dateOnly);
  return p ? zonedTimeToUtc({ ...p, hour: 23, minute: 59, second: 59, ms: 999 }, timeZone) : new Date(NaN);
}

// Calendar date ('YYYY-MM-DD') of a timestamp or date-only value in the report timezone.
function zonedDateString(value, timeZone = REPORT_TIMEZONE) {
  if (value == null || value === '') return '';
  if (parseDateOnly(value)) return String(value);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = zonedParts(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(dateOnly, days) {
  const p = parseDateOnly(dateOnly);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

module.exports = { REPORT_TIMEZONE, resolveTimezone, zonedParts, zonedTimeToUtc, parseDateOnly,
  dayStartUtc, dayEndUtc, zonedDateString, addDays };
