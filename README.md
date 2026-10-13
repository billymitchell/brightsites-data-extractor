# BrightSites Report Exporter

Express and vanilla JavaScript application that fetches BrightSites orders and exports CSV reports or a linked Excel workbook.

## Setup

1. Copy `.env.example` to `.env` and configure either `BRIGHTSITES_STORES` or the legacy `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN` variables.
2. Install dependencies and start the server:

   ```bash
   npm install
   npm start
   ```

3. Open http://127.0.0.1:3000, select a store, table type and date range, choose any desired status/format options, then run and download the report.

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

- **Shipment Level** (default): one row for each item in each shipment, with rows for unshipped items. An item split across shipments appears more than once. Downloads CSV.
- **Order Level**: one row per unique source order, including orders with no items or shipments. Financial totals come from the order once; quantities summarize original items and distinct shipments. Unknown quantities remain blank; real zero remains zero. Downloads CSV.
- **Both tables (Excel)**: builds both tables from the same source fetch and enrichment pass. Switch between **Order Level** and **Shipment Level** previews and choose columns/split settings separately for each. **Download Excel** saves both tabs in one `.xlsx` file.
- Reports require a selected store and both start and end dates; reversed ranges are rejected. Date-only end dates include the full selected day.
- Jobs run asynchronously. The browser polls for progress and can request cancellation.
- At most two jobs run at once by default. Configure `REPORT_JOB_MAX_ACTIVE` to change the limit.
- Reports are limited to 50,000 rows by default; Both mode counts rows across both tables. Larger results fail with guidance to narrow the date range. Configure `REPORT_MAX_ROWS` to change this limit.
- Up to five completed report results are retained in memory by default. Older results are evicted when new reports complete. Configure `REPORT_JOB_MAX_RETAINED_RESULTS` to change this limit.
- Job records expire after four hours by default (`REPORT_JOB_TTL_MS`); cleanup runs every ten minutes (`REPORT_JOB_CLEANUP_INTERVAL_MS`).
- Jobs and report results are held in memory and are lost when the server restarts.
- Usage counts are stored in `data/usage.json`; the running process caches the file to avoid rereading it for every API request.

## Linked Excel reports

The **Order Level** and **Shipment Level** tabs contain native Excel tables named `OrdersTable` and `ShipmentsTable`, with filters and frozen headers. Both include a mandatory text **Order Key**, formed from the store subdomain and canonical order identifier. It links one order to all its detail rows even if the displayed Order # is hidden or reused.

**View Shipments** opens the first matching detail row. Filter the Shipment Level **Order Key** column to see every related item. Each detail row has **View Order** to return to its parent. **Shipment Detail Rows** counts related rows; **Shipment Count** counts distinct source shipments. For example, order `00100` with two items split across two shipments has one order row, three detail rows, an original/shipped quantity of five, and an order total of 125.00 counted once in Order Level.

Links and detail counts use key-based formulas and recalculate when either table is sorted. Keep Excel's calculation mode automatic, or recalculate after editing. The workbook is a snapshot of one completed job: it does not refresh BrightSites data, and source amounts/quantities do not recalculate when rows are edited. Order-level dynamic values identify their item, for example `7: Matte; 8: Glossy` in **Product Option: Finish**.

Excel exports allow one build at a time and default to **10,000 combined data rows** (`WORKBOOK_MAX_ROWS`) and **100,000 cells**, including headers and relationship columns (`WORKBOOK_MAX_CELLS`). These checks run before allocating the expanded dynamic table. Exceeding a limit returns an error; select fewer columns or narrow the date range. Results are never truncated, and generated workbook buffers are not retained. A representative 97,776-cell export peaked at about 249 MiB in an isolated process; overall server memory also depends on retained jobs.

API clients can send `reportLevel: "shipment"`, `"order"`, or `"both"` to `POST /api/run`. Single modes keep the existing `columns`/`rows` result shape; Both returns `tables.order` and `tables.shipment`, each with aligned `rowKeys`. Download a completed Both job with `POST /api/run/:jobId/workbook`; the optional body is `{ "selections": { "order": { "columns": ["Order #"], "splitPairs": true }, "shipment": { "columns": ["Order #", "Product Options"], "splitPairs": true } } }`. Omitted selections include all columns without splitting. The endpoint uses server-held rows and accepts selection settings only.

## CSV behavior

- The standard report column names are defined in `config/report.js`; the misspelling **"Shipping Landded Cost"** is intentional.
- "Split Product Personalization and Product Options" turns each key into its own column (e.g. `Product Personalization: Establishment Name`, `... Establishment Name Price`, `Product Option: Award Level`). Rows with the same keys share columns; unique keys add columns. Not used with Danielle's Format.
- Split columns are discovered dynamically from the actual keys across every report row, including newly added options. For example, `Finish: Matte` adds `Product Option: Finish`; rows without that key have a blank cell. Structured options take priority over summary text. An unlabeled value such as `Version: Plaque, 4 Star, 2026, Hotel` stays in `Product Option: Version`; its comma-separated parts do not supply separate keys.
- Danielle's Format is a separate client-side column mapping available only for standalone Shipment Level CSV reports.
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

Create an app at developer.ups.com with the Tracking API enabled, then set `UPS_CLIENT_ID` and `UPS_CLIENT_SECRET` (on Heroku: `heroku config:set ...`). Tick **Add UPS tracking data** before running a report. Each UPS tracking number (starting `1Z`) is looked up once and appended as `UPS Status`, `UPS Service`, `UPS Weight` and `Expected Delivery Date` columns, plus Last Scan, Delivered Date/Time, Received By, Delivery Location, Origin, Destination, Reference Numbers, Package Count, Additional Services, Dimensions and Alternate Tracking # (all from the Tracking API response; blank when UPS doesn't return them). The Tracking API does not return the shipper/billing account number (it is only a request filter), so that needs the UPS invoice data; other carriers are left blank. Delivered results are cached for 24 hours, others for 15 minutes. A failed lookup shows `Lookup failed` and does not stop the report. UPS's Tracking API does not return billed shipping charges; those only come from UPS invoices.

UPS enrichment is available in Shipment Level and Both mode, and applies only to shipment rows. Order-only requests with UPS enabled are rejected.


## Choosing columns

Use **Choose report columns** in the UI to pick which fields appear in the active table's preview and download (saved separately for each level in your browser; "Core columns" restores that level's core set). Excel always retains the relationship/navigation columns. Extra fields include order sales tax, shipping tax, discounts, customer email, payment method/status, in-hands date, product/internal IDs, tax code, base/options price, logo charges and line-item notes. Tax and shipping come from BrightSites `tax_price`, `shipment.cost` and `required_adjustments`.

## Known issues / next session

Review these at the start of the next session and decide whether to fix them:

1. **Memory use on large reports.** Each finished report keeps its full rows plus the personalization/option detail in memory (`REPORT_JOB_MAX_RETAINED_RESULTS`, default 5, up to 50,000 rows each). On a 512 MB Basic dyno this can run out of memory. Suggested: lower the default to 2 or set `REPORT_JOB_MAX_RETAINED_RESULTS=2` on Heroku.
2. **Multiple UPS tracking numbers in one cell.** The UPS lookup only matches a cell containing exactly one `1Z...` number, so a shipment with several tracking numbers gets blank UPS columns. Suggested: split the cell, look up each number, and join the results.
