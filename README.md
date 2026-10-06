# BrightSites CSV Exporter

Express and vanilla JavaScript application that fetches BrightSites orders and exports a CSV.

## Setup

1. Copy `.env.example` to `.env` and configure either `BRIGHTSITES_STORES` or the legacy `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN` variables.
2. Install dependencies and start the server:

   ```bash
   npm install
   npm start
   ```

3. Open http://127.0.0.1:3000, select a store and date range, choose any desired status/format options, then run the report and download the CSV.

Locally the server listens on `127.0.0.1` (override with `HOST`). On Heroku (or `NODE_ENV=production`) it listens on `0.0.0.0:$PORT`.

## Deploying to Heroku (password protected)

```sh
heroku config:set NODE_ENV=production \
  APP_PASSWORD='a-long-random-passphrase' \
  SESSION_SECRET=$(openssl rand -hex 32) \
  BRIGHTSITES_STORES='{"key":{"subdomain":"foo","token":"...","label":"Foo"}}'
```

- Every page and `/api` route requires sign-in; sessions are signed HttpOnly cookies (default 8h, `SESSION_TTL_MS`). Logins are throttled to 5 failures per 15 minutes per IP.
- In production the app refuses to start without `APP_PASSWORD` and `SESSION_SECRET`, and redirects HTTP to HTTPS.
- Heroku's filesystem is ephemeral: `data/usage.json` and `server.log` reset on restart, and in-memory report jobs are lost if the dyno restarts. Use a single dyno.
- A shared password is simple but not per-user; rotate it when a teammate leaves.

## Store configuration

For multiple stores, set `BRIGHTSITES_STORES` to a JSON object keyed by store key:

```json
{
  "shop-a": { "subdomain": "shop-a", "token": "API_TOKEN", "label": "Shop A" },
  "shop-b": { "subdomain": "shop-b", "token": "API_TOKEN", "label": "Shop B" }
}
```

The legacy single-store variables remain supported. Keep credentials in `.env`; do not commit it.

## Reports and job retention

- Reports require a selected store and both start and end dates; reversed ranges are rejected. Date-only end dates include the full selected day.
- Jobs run asynchronously. The browser polls for progress and can request cancellation.
- At most two jobs run at once by default. Configure `REPORT_JOB_MAX_ACTIVE` to change the limit.
- Reports are limited to 50,000 rows by default; larger results fail with guidance to narrow the date range. Configure `REPORT_MAX_ROWS` to change this limit.
- Up to five completed CSV results are retained in memory by default. Older results are evicted when new reports complete. Configure `REPORT_JOB_MAX_RETAINED_RESULTS` to change this limit.
- Job records expire after four hours by default (`REPORT_JOB_TTL_MS`); cleanup runs every ten minutes (`REPORT_JOB_CLEANUP_INTERVAL_MS`).
- Jobs and report results are held in memory and are lost when the server restarts.
- Usage counts are stored in `data/usage.json`; the running process caches the file to avoid rereading it for every API request.

## CSV behavior

- The standard report column names are defined in `config/report.js`; the misspelling **"Shipping Landded Cost"** is intentional.
- Danielle's Format is a separate client-side column mapping.
- CSV values are escaped and prefixed when they could be interpreted as spreadsheet formulas.
- BrightSites API access uses v2.6.1; requests are paginated and rate-limited per token.

## Development

Run the automated tests with:

```bash
npm test
```

## Support / debug info

Click **Download support info** (top right of the page) to save a plain-text `support-report-*.txt` file. It lists recent reports (store, dates, orders, rows, duration, errors), BrightSites API calls this month, web request counts, warnings/errors, and the last 100 log events. Tokens, passwords and cookies are hidden. Send that file when asking for help. Browser-side script errors are also logged. The data is in memory (last 500 log events, last 50 reports) and resets on restart; `server.log` keeps the full file log locally, and on Heroku use `heroku logs --tail`.

## UPS tracking data (optional)

Create an app at developer.ups.com with the Tracking API enabled, then set `UPS_CLIENT_ID` and `UPS_CLIENT_SECRET` (on Heroku: `heroku config:set ...`). Tick **Add UPS tracking data** before running a report. Each UPS tracking number (starting `1Z`) is looked up once and appended as `UPS Status`, `UPS Service`, `UPS Weight` and `Expected Delivery Date` columns; other carriers are left blank. Delivered results are cached for 24 hours, others for 15 minutes. A failed lookup shows `Lookup failed` and does not stop the report. UPS's Tracking API does not return billed shipping charges; those only come from UPS invoices.
