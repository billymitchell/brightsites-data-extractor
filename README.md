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

## Authentication and Heroku deployment

The current password login remains the default (`AUTH_MODE=password`) until company email sign-in is configured. Production refuses to start without the required authentication configuration and redirects HTTP to HTTPS.

### Company email sign-in (Supabase Auth + Resend)

Set `AUTH_MODE=email` to replace the shared password with emailed one-time codes. Only verified addresses on the exact `centricitynow.com` domain are accepted; subdomains and lookalike domains are rejected. There is no password fallback in email mode, and existing shared-password cookies do not grant access.

The app stays at https://ftg-billing-e2fcc1ef48a1.herokuapp.com/login. No custom website domain is needed. Supabase manages email-code verification and users; Resend provides SMTP delivery.

1. Create a separate Supabase project in the **Centricity** organization on the Free plan. Account column defaults also require the table described below.
2. Create a Resend account and verify a sender domain you control using the DNS records Resend provides. This is email-sender verification only, not a website DNS change. Choose a verified From address, and create a sending-only Resend API key.
3. In Supabase **Authentication → Email / SMTP settings**, enable custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, and the Resend API key as the SMTP password. Set the sender email to your verified From address. Do not rely on Supabase's default email delivery: it is restricted and unsuitable for general production sign-ins.
4. Enable the Email provider and allow new user sign-ups. In **Email Templates → Magic Link**, include the literal `{{ .Token }}` in the email body so users receive a code rather than a link. Set email OTP expiry to **600 seconds**, retain the resend cooldown, and configure Supabase email/verification rate limits for expected usage. Configure CAPTCHA or an Auth hook if needed to protect the public Supabase OTP endpoint from abuse; the app's rate limits apply only to requests through this server.
5. Set Supabase's Site URL to `https://ftg-billing-e2fcc1ef48a1.herokuapp.com`. Obtain the project URL and **publishable key** (a legacy `anon` key also works). Authentication uses the publishable key; the separate server-only secret below is used only for account preferences.
6. Configure the app through secure Heroku settings (or an untracked local `.env`):

   ```text
   AUTH_MODE=email
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-project-publishable-key
   SESSION_SECRET=a-random-secret-at-least-32-characters
   SESSION_TTL_MS=28800000
   ```

   Generate `SESSION_SECRET` locally with `openssl rand -hex 32`. Keep credentials out of source control and chat. Once configured, restart/deploy and verify a real company inbox can receive a code, complete sign-in, access reports, and sign out. Also verify a non-company email is rejected. Do not enable email mode before SMTP and templates are ready.

Codes are checked server-side with Supabase; the returned access token is used to fetch the authenticated user and confirm the email before access is granted. Supabase access/refresh tokens are not stored in the browser or localStorage. The app creates its own signed HttpOnly, SameSite=Strict session cookie (Secure in production), lasting 8 hours by default. Sign-out clears local cookies; deleting or disabling a Supabase user does not revoke an already-issued app cookie until it expires. Rotate `SESSION_SECRET` to invalidate all app sessions immediately.

Code-request cookies expire after 10 minutes. Each 15-minute window allows 3 code sends and 5 verification attempts per email, with additional IP limits of 20 sends and 50 verification attempts so colleagues can share an office connection. These bounded limits live in memory and reset on process restart; use a single dyno and Supabase's provider-side limits. Invalid/expired codes and email-service outages are shown explicitly rather than bypassing authentication.

Free-tier limits may change. At implementation, Supabase Free included 50,000 monthly active users and could pause after a week of inactivity; Resend Free included 3,000 emails/month, capped at 100/day. Check [Supabase pricing](https://supabase.com/pricing) and [Resend pricing](https://resend.com/pricing) before rollout.

### Shared password (existing deployment)

```sh
heroku config:set NODE_ENV=production \
  APP_PASSWORD='a-long-random-passphrase' \
  SESSION_SECRET=$(openssl rand -hex 32) \
  BRIGHTSITES_STORES='{"key":{"subdomain":"foo","token":"...","label":"Foo"}}'
```

- Every page and `/api` route requires sign-in; sessions are signed HttpOnly cookies (default 8h, `SESSION_TTL_MS`). Logins are throttled to 5 failures per 15 minutes per IP.
- With `AUTH_MODE=password`, production requires `APP_PASSWORD` and `SESSION_SECRET`.
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

Links and detail counts use key-based formulas and recalculate when either table is sorted. Keep Excel's calculation mode automatic, or recalculate after editing. The workbook is a snapshot of one completed job: it does not refresh BrightSites data, and source amounts/quantities do not recalculate when rows are edited. Order-level summaries contain distinct readable values, for example `Matte; Glossy` in **Product Option: Finish**. Use Shipment Level for each individual item's values.

Excel exports allow one build at a time and default to **10,000 combined data rows** (`WORKBOOK_MAX_ROWS`) and **100,000 cells**, including headers and relationship columns (`WORKBOOK_MAX_CELLS`). These checks run before allocating the expanded dynamic table. Exceeding a limit returns an error; select fewer columns or narrow the date range. Results are never truncated, and generated workbook buffers are not retained. A representative 97,776-cell export peaked at about 249 MiB in an isolated process; overall server memory also depends on retained jobs.

API clients can send `reportLevel: "shipment"`, `"order"`, or `"both"` to `POST /api/run`. Single modes keep the existing `columns`/`rows` result shape; Both returns `tables.order` and `tables.shipment`, each with aligned `rowKeys`. Download a completed Both job with `POST /api/run/:jobId/workbook`; the optional body is `{ "selections": { "order": { "columns": ["Order #"], "splitPairs": true }, "shipment": { "columns": ["Order #", "Product Options"], "splitPairs": true } } }`. Omitted selections include all columns without splitting. The endpoint uses server-held rows and accepts selection settings only.

## CSV behavior

- The standard report column names are defined in `config/report.js`; the misspelling **"Shipping Landded Cost"** is intentional.
- "Split Product Personalization and Product Options" turns each key into its own column (e.g. `Product Personalization: Establishment Name`, `... Establishment Name Price`, `Product Option: Award Level`). Rows with the same keys share columns; unique keys add columns. Not used with Danielle's Format.
- Split columns are discovered dynamically from the actual keys across every report row, including newly added options. For example, `Finish: Matte` adds `Product Option: Finish`; rows without that key have a blank cell. Structured options take priority over summary text. The confirmed four-part Version format (`Plaque, 4 Star, 2026, Hotel`) expands to `Product Option: Product Type`, `Product Option: Award Level`, `Product Option: Year`, and `Product Option: Category`. It requires four nonempty parts with a four-digit year in the third position. Other Version formats and comma-containing option values retain their original key and value. With splitting off, the original Version text remains available.
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

## UPS tracking data (enabled by default)

Create an app at developer.ups.com with the Tracking API enabled, then set `UPS_CLIENT_ID` and `UPS_CLIENT_SECRET` (on Heroku: `heroku config:set ...`). UPS tracking data is added automatically; no checkbox is needed. Each UPS tracking number (starting `1Z`) is looked up once and appended as `UPS Status`, `UPS Service`, `UPS Weight` and `Expected Delivery Date` columns, plus Last Scan, Delivered Date/Time, Received By, Delivery Location, Origin, Destination, Reference Numbers, Package Count, Additional Services, Dimensions and Alternate Tracking # (all from the Tracking API response; blank when UPS doesn't return them). The Tracking API does not return the shipper/billing account number (it is only a request filter), so that needs the UPS invoice data; other carriers are left blank. Delivered results are cached for 24 hours, others for 15 minutes. A failed lookup shows `Lookup failed` and does not stop the report. UPS's Tracking API does not return billed shipping charges; those only come from UPS invoices.

UPS enrichment is enabled by default in Shipment Level and Both mode, and applies only to shipment rows. Missing UPS credentials cause these reports to fail with a configuration error. API clients can explicitly send `includeUps: false` to opt out. Order-only reports skip enrichment; order-only requests with `includeUps: true` are rejected.


## Choosing columns

Use **Choose report columns** to select fields, then the up/down buttons under **Arrange selected columns** to set their order. Selection, order and split settings save automatically to your signed-in account, separately for Order Level and Shipment Level. They are restored on another browser or device after sign-in. New accounts start with all columns; existing browser-only selections are not imported. "Core columns" restores the active level's core set.

The save indicator confirms when changes reach your account. If saving fails, use **Retry** before leaving the page; unsaved changes are retained for retry while the page remains open. If loading fails, retry before editing columns or running a report. Shared-password/local development mode keeps browser-local preferences instead of account storage.

Preview, CSV and Excel use the same selected-column order. Split personalization/option fields follow their parent field's position. Excel always retains its mandatory Order Key and relationship/navigation columns. Danielle's Format keeps its fixed schema. Extra fields include order sales tax, shipping tax, discounts, customer email, payment method/status, in-hands date, product/internal IDs, tax code, base/options price, logo charges and line-item notes. Tax and shipping come from BrightSites `tax_price`, `shipment.cost` and `required_adjustments`.

### Account preference storage setup

Before deploying account defaults:

1. Execute [the migration](supabase/migrations/20261103000000_report_column_preferences.sql) once in the same Supabase project's SQL Editor. It creates `report_column_preferences`, enables row-level security, and denies direct browser access.
2. In **Project Settings → API Keys → Secret keys**, obtain a server secret (`sb_secret_...`; a legacy `service_role` key also works).
3. Set `SUPABASE_SECRET_KEY` in the ignored local `.env` and secure Heroku config, alongside `SUPABASE_URL`. Never commit this privileged key, expose it in browser JavaScript, or use it as the authentication publishable key. Restart the server after configuring it.

Preferences are keyed by the verified company email from the app session, not a client-supplied identity. `GET /api/preferences/columns` loads both layouts; `PUT /api/preferences/columns/:level` saves a validated layout for `order` or `shipment`. Missing storage configuration or failed database requests produce explicit load/save errors rather than silently reverting to browser storage.

## Known issues / next session

Review these at the start of the next session and decide whether to fix them:

1. **Memory use on large reports.** Each finished report keeps its full rows plus the personalization/option detail in memory (`REPORT_JOB_MAX_RETAINED_RESULTS`, default 5, up to 50,000 rows each). On a 512 MB Basic dyno this can run out of memory. Suggested: lower the default to 2 or set `REPORT_JOB_MAX_RETAINED_RESULTS=2` on Heroku.
2. **Multiple UPS tracking numbers in one cell.** The UPS lookup only matches a cell containing exactly one `1Z...` number, so a shipment with several tracking numbers gets blank UPS columns. Suggested: split the cell, look up each number, and join the results.
