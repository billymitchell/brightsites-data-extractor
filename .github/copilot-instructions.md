# Copilot project instructions

Purpose: Help AI agents work productively in this BrightSites CSV exporter.

Overview
- Minimal Express server (`server.js`) + static UI (`public/index.html`). No build step, no DB.
- Core BrightSites API client lives in `lib/brightSites.js`; usage tracking in `lib/usage.js` (writes to `data/usage.json`).
- Primary flow: client POSTs `/api/run` → server fetches orders + line items + shipments (concurrency-limited) → returns `{ columns, rows, meta }` which the UI previews and exports to CSV.

Environment and stores
- Configure stores via env var `BRIGHTSITES_STORES` as JSON: `{ "tokenKey": { "subdomain": "foo", "token": "...", "label": "Foo" }, ... }`.
- Legacy single-store envs `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN` are supported as defaults when `opts` are not passed to helpers.
- The UI requires an explicit store selection; the server rejects `/api/run` without `storeKey`.

Endpoints (server.js)
- POST `/api/run` body: `{ storeKey, reportType, dateFilterType, status?, start?, end? }`. Returns `{ columns, rows, meta }`.
- GET `/api/stores` returns configured stores `[ { key, label, subdomain } ]` from `BRIGHTSITES_STORES`.
- GET `/api/usage?month=YYYY-MM&store=tokenKey` returns usage/cost metrics; POST `/api/usage/reset { month? }` resets.

BrightSites client (lib/brightSites.js)
- `fetchAllPages(path, params, pageSize=200, opts)` paginates until last page (< pageSize). Accepts multiple response shapes (array or object with `orders|items|data|results`).
- `loadOrder(orderId, opts)`, `loadLineItems(orderId, opts)`, `loadShipments(orderId, opts)` fetch related resources.
- `composeAddressBlob(addr, order, extras)` creates a human-readable address block with robust field fallbacks; `trackingForLineItem({ order, shipments }, lineItemId)` maps tracking per item.
- All network attempts increment usage via `lib/usage.increment(token, 1)` using the token extracted from the URL.

CSV shape and UI
- Required header order held in server as `COLUMNS`; additional structured columns in `STRUCTURED_COLUMNS`. Combined list returned as `columns`.
- The UI persists which structured columns to include (localStorage key `brightsites_structured_columns_v1`) and builds CSV client-side.
- Known misspelling is intentional: "Shipping Landded Cost" must remain as-is.
- SKU column: populated from `line_items.final_sku` when available, falling back to common aliases (`sku`, `product_sku`, `variant_sku`, etc.).

Patterns and conventions
- Avoid hard-coded defaults for stores; rely on `BRIGHTSITES_STORES` and explicit `storeKey`.
- Use `promisePool(items, worker, concurrency=5)` in `server.js` for bounded parallel enrichment.
- Prefer order "show" fields (`billing_contact`, `billing_address`, etc.) when present; fall back to merged alternatives.
- Respect pagination and rate limiting—`safeFetch` retries (2) with delay; keep per-page at 200 unless required.

Local dev workflow
- Env: copy `.env.example` → `.env` and set `BRIGHTSITES_STORES` (or legacy single-store vars).
- Run: `npm install` then `npm start` (serves on http://localhost:3000).
- Test quickly: open UI, pick a store, run with a small date range; check `data/usage.json` and `/api/usage` for counters.

Examples
- Fetch all orders for last 7 days (created_at): UI preset or POST `/api/run` with `{ storeKey, reportType: "Needed Excel", dateFilterType: "created_at", start, end }`.
- Programmatic usage: `const { fetchAllPages } = require('./lib/brightSites'); await fetchAllPages('/orders', { status: 'completed' }, 200, { subdomain, token });`