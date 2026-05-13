# Copilot project instructions

Purpose: Help AI agents work productively in this BrightSites CSV exporter.

## Overview
- Express server + static UI (`public/index.html`). No build step, no DB.
- Core BrightSites API client in `lib/brightSites.js`; usage tracking in `lib/usage.js` (writes to `data/usage.json`).
- **Async job pattern**: POST `/api/run` returns immediately with job ID; UI polls until completion.

## Architecture
```
server.js                 → Entry point, mounts routes
├── config/               → Constants (columns, stores)
├── routes/               → Express route handlers
│   ├── reportRoutes.js   → POST /api/run, GET /api/run/:jobId
│   ├── storeRoutes.js    → GET /api/stores
│   └── usageRoutes.js    → Usage endpoints
├── services/
│   ├── orderService.js   → Request validation, order fetching
│   ├── reportJobService.js → In-memory job queue, async execution
│   └── reportRowBuilder.js → Order enrichment → row transformation
├── lib/                  → Shared modules (API client, usage)
└── utils/                → Helpers (async pool, cancellation, formatters)
```

## Environment and stores
- Configure stores via env var `BRIGHTSITES_STORES` as JSON: `{ "tokenKey": { "subdomain": "foo", "token": "...", "label": "Foo" }, ... }`.
- Legacy single-store envs `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN` are supported as defaults.
- The UI requires an explicit store selection; the server rejects `/api/run` without `storeKey`.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/run` | Start report job. Body: `{ storeKey, reportType, dateFilterType, status?, start?, end? }`. Returns `{ id, statusUrl }` |
| GET | `/api/run/:jobId` | Poll job status. Returns progress, status, result when complete |
| POST | `/api/run/:jobId/cancel` | Cancel a running job |
| GET | `/api/stores` | List configured stores `[ { key, label, subdomain } ]` |
| GET | `/api/usage?month=YYYY-MM&store=tokenKey` | Usage metrics |
| POST | `/api/usage/reset` | Reset usage counters |

## BrightSites client (lib/brightSites.js)
- `fetchAllPages(path, params, pageSize=200, opts)` — Paginates until last page. Handles multiple response shapes.
- `loadOrder(orderId, opts)`, `loadLineItems(orderId, opts)`, `loadShipments(orderId, opts)` — Fetch related resources.
- `composeAddressBlob(addr, order, extras)` — Human-readable address block with robust fallbacks.
- **Rate limiting**: Per-token gating via `waitForRequestSlot()`, exponential backoff on 429s.
- All requests increment usage via `lib/usage.increment(token, 1)`.

## CSV shape and UI
- Required header order in `COLUMNS`; additional structured columns in `STRUCTURED_COLUMNS` (both in `config/report.js`).
- The UI persists which structured columns to include (localStorage key `brightsites_structured_columns_v1`) and builds CSV client-side.
- Known misspelling is intentional: **"Shipping Landded Cost"** — do not correct.
- SKU column: uses `line_items.final_sku` when available, falling back to `sku`, `product_sku`, `variant_sku`, etc.

## Patterns and conventions
- **Async job lifecycle**: queued → running → completed/failed/canceled. Use `createJob()`, job stores in-memory Map.
- **Cancellation**: Check `throwIfCanceled(isCanceled)` from `utils/cancel.js` at safe points during long operations.
- **Progress callbacks**: `onProgress({ phase, ordersProcessed, ordersTotal, message })` updates job state for UI polling.
- **Bounded concurrency**: Use `promisePool(items, worker, concurrency=5)` from `utils/async.js` for parallel API calls.
- **Field resolution**: `pickFirstValue(obj, ...keys)` from `utils/fields.js` handles inconsistent API field names.
- Prefer order "show" fields (`billing_contact`, `billing_address`) when present; fall back to merged alternatives.
- Avoid hard-coded defaults for stores; always require explicit `storeKey`.

## Local dev workflow
1. `cp .env.example .env` → set `BRIGHTSITES_STORES` JSON (or legacy single-store vars)
2. `npm install && npm start` → http://localhost:3000
3. Test: pick store, small date range, Run, check `data/usage.json`

## Examples
```js
// Fetch all orders for last 7 days
await fetchAllPages('/orders', { created_at_from, created_at_to }, 200, { subdomain, token });

// Bounded parallel enrichment
const enriched = await promisePool(orders, async (order) => {
  const [full, lineItems, shipments] = await Promise.all([
    loadOrder(order.id, opts),
    loadLineItems(order.id, opts),
    loadShipments(order.id, opts)
  ]);
  return { ...full, lineItems, shipments };
}, 5);
```