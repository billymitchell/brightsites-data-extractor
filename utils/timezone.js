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

module.exports = { REPORT_TIMEZONE, resolveTimezone, zonedParts, zonedTimeToUtc };
