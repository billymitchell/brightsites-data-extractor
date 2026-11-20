# Report Table Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let users query Order Level, Shipment Level, or both together, and export both as linked tables on separate tabs of one Excel workbook.

**Architecture:** Fetch and enrich the selected orders once, then build the requested order and/or shipment tables from that shared source. Both tables carry matching order keys and independent schemas and dynamic details. A server-side Excel exporter writes linked, filterable tables to two worksheets using the same view transformations as the preview.

**Tech Stack:** Existing Node.js, CommonJS, Express, vanilla browser JavaScript, and `node:test`; add one pinned ExcelJS dependency for native `.xlsx` export. Verify its release compatibility and commit the lockfile during implementation. Workbook features are documented in the [official ExcelJS reference](https://github.com/exceljs/exceljs/blob/master/README.md).

**Spec:** The design brief below. Implemented on `feature/report-table-levels`; verification and execution decisions are recorded in [the acceptance record](../../verification/2026-10-13-report-table-levels.md).

**Subsequent correction:** Production feedback requested readable Order Level summaries without item-ID prefixes and reaffirmed the earlier approved four-part Version split. Those requirements supersede the item-prefix and no-positional-Version rules in the original design below. The confirmed Version shape expands into Product Type, Award Level, Year and Category; other named option keys continue to be discovered dynamically. See the [correction record](../../verification/2026-10-13-option-summary-correction.md).

## Design brief

### User-facing behavior

Add a **Table type** selector beside Store and Date Preset:

| Selection | Meaning of one row | Example: order has two items, each shipped once |
|---|---|---|
| Order Level | One unique order, regardless of item or shipment count | 1 row |
| Shipment Level (default) | One unique line item within each shipment; items without a shipment also appear | 2 rows |
| Both tables (Excel) | Generate both levels in the same job | Order tab: 1 row; Shipment tab: 2 rows |

If the same item is split across two shipments, Shipment Level keeps both shipment rows. “Unique item” means a line item ID, not a SKU: two purchased items with the same SKU can have different personalization. Order Level still produces one row. Preserve the current Shipment Level columns and behavior, including unshipped-item rows.

The selector controls how a fresh query is built. Changing it clears the existing result and requires Run again; it does not reinterpret a completed result. Disable it while a job is active. Both mode shows **Order Level** and **Shipment Level** preview tabs and a **Download Excel** button that downloads both tables regardless of the active preview tab. Single-level modes keep Download CSV. Date ranges and status filters continue to select orders using the existing placed/created-date behavior; this feature does not add ship-date filtering.

### Order Level columns and calculations

Use the existing Order, Customer & payment, Billing contact, and Shipping contact fields, plus Store Shipping Cost. Keep their current names and formats. Read order-level totals, taxes, discounts, and shipping charges from the original order once, rather than summing the repeated values in shipment rows.

Add these summary fields:

| Column | Rule |
|---|---|
| Unique Item Count | Count distinct line item IDs in the original order's line-item response |
| Original Quantity | Sum ordered quantities once per distinct line item ID |
| Shipped Quantity | Sum known shipped quantities across distinct shipments and their item allocations |
| Shipment Count | Count distinct shipments, using shipment ID where supplied |
| Tracking # | Distinct nonempty tracking numbers joined with `; ` |
| First Ship Date / Last Ship Date | Earliest/latest valid shipment date, formatted like existing dates |

Orders with a successful empty line-item or shipment response still get one order row. Empty collections produce zero counts/quantities; if any applicable quantity is missing or invalid, leave that quantity total blank rather than claiming zero. Preserve legitimate numeric zero. A shipment without an ID uses its response position as its identity; do not collapse separate shipments just because they share tracking or item IDs.

Optional **Item summaries** columns: Product Name, SKU, Product Options, and Product Personalization. Prefix each summarized value with its line item ID, e.g. `7: Matte; 8: Glossy`, to preserve which item supplied it. Exclude Line Item ID, Product ID, Internal ID, Unit Price, Base Price, Options Price, Logo Charges, Line Item Note, and line-item Total Price/Tax Total from the Order Level catalog; those are available in Shipment Level.

The core Order Level selection is Order #, Placed, Order Status, Order Total, Order Item Total, Store Shipping Cost, Customer Email, Unique Item Count, Original Quantity, Shipped Quantity, Shipment Count, and Tracking #. Other eligible fields remain selectable.

### Dynamic option and personalization columns

Keep the existing split switch in both levels. Discover keys from all applicable items, with no predefined list or positional Version mapping. Shipment Level keeps its current per-item values. Order Level combines values for each actual key with line item IDs, e.g. `Product Option: Finish` contains `7: Matte; 8: Glossy`. Discover new keys even if they occur after the first order or outside the first 50 preview rows. Rows without a key have blank cells.

Populate one `rowDetails` entry per output row in each table. In Order Level, gather detail from the original distinct items once; do not repeat an item's personalization because it appears in several shipments. Unsplit summaries and split values follow the same item associations.

### Linked Excel workbook

Both mode exports `brightsites_orders_and_shipments.xlsx` with exactly two tabs in this order:

| Worksheet | Native Excel table | Relationship |
|---|---|---|
| Order Level | `OrdersTable` | One row per unique Order Key (parent) |
| Shipment Level | `ShipmentsTable` | Multiple item/shipment rows can reference the same Order Key (children) |

Add **Order Key** as the first column on each workbook sheet, with the same text value for the same order. Preserve human-readable Order # where selected. Keep keys as text to protect leading zeros and long IDs. Order Key is required in the workbook even if the user hides Order # or clears the other column selections. CSV column layouts remain as previously planned.

The relationship is one order to many shipment/item rows. Validate unique parent keys and require every child key to exist on Order Level. A parent order may have no detail rows, including a successful order with no items. Shipment rows must not be grouped or joined on SKU, tracking number, or their current row position.

Provide **View Order** on Shipment Level and **View Shipments** on Order Level. Use key-based internal hyperlink formulas with `MATCH` against the other native table's Order Key column, rather than fixed row destinations, so navigation follows supported sorts. View Shipments goes to the first matching detail row; users can filter Shipment Level by Order Key to see all matches. For an order with no detail rows, display `No shipment items`. Do not claim that a link automatically filters Excel rows. Add **Shipment Detail Rows** on Order Level as a `COUNTIF` formula against the child table. This count includes current unshipped-item rows and is separate from Shipment Count.

Keep source financial totals as source values. Do not use `SUMIF` on repeated shipment Order Total or Original Quantity fields to construct order summaries. Formulas own only navigation and the detail-row count. Cache their initial display values and request full recalculation on open; verify actual formula and sorting behavior in Excel during implementation.

Create filterable Excel tables, frozen header rows, restrained table styling, readable widths, wrapped long summaries, and appropriate number/date formats. Treat source text as literal string cells, including values beginning with `=`, `+`, `-`, or `@`; generate formulas only from exporter-controlled templates. Use typed numeric quantities and money when valid; keep IDs, ZIP codes, SKUs, tracking numbers, and missing values in their appropriate text/blank types.

For empty results, keep both worksheet headers with zero data records and no fabricated placeholder rows. Only create native table objects on nonempty sheets; if there are no child rows, use literal zero/count and `No shipment items` instead of formulas referencing an absent table. This exception must be tested explicitly.

Generate the workbook from the completed job without fetching BrightSites again. Apply column selections and the split switch separately to both tables using the same shared view function as the browser. Always retain required key/link columns in Excel. Do not store an additional XLSX copy with every retained result. Limit workbook generation to one concurrent export, release transient buffers afterward, and include a representative-size memory check in final verification.

### Compatibility and failure behavior

- Existing requests without a report level use Shipment Level.
- Preserve cancellation, progress updates, row limits, result retention, authentication, CSV escaping, and current dynamic-key fixes.
- Keep Danielle's Format available in standalone Shipment Level; disable it in Order Level and Both mode for this initial feature. UPS enrichment is available in Shipment Level and Both mode and applies only to shipment rows. Disable UPS in standalone Order Level; a direct Order Level request with `includeUps: true` returns HTTP 400. Danielle's schema expects item rows, while order summaries can contain multiple tracking numbers.
- Keep existing Shipment Level column preferences. Save Order Level selections separately.
- Failed enrichment must not masquerade as an empty order. Add opt-in `failOnError: true` to the BrightSites loaders and use it for Order Level and Both mode; preserve the loaders' existing defaults for standalone Shipment Level. An Order Level or Both mode enrichment failure fails the job with a useful error and no partial downloadable result.
- Deduplicate Order Level and Both mode source orders by the existing API lookup identifier (`id`, then `order_id`, then `orderNumber`, then `number`) before enrichment. Continue displaying `order_id` as Order # where available. Report a missing lookup identifier as an error. Reports remain scoped to the selected store.

### Example acceptance case

Order 100 contains line item 7 (quantity 3, Matte) and line item 8 (quantity 2, Glossy). Shipment A ships 1 unit of item 7; shipment B ships its remaining 2 units and 2 units of item 8. The order total is 125.00.

- Shipment Level: three rows: A/7, B/7, B/8.
- Order Level: one row; Unique Item Count = 2, Original Quantity = 5, Shipped Quantity = 5, Shipment Count = 2, Order Total = 125.00.
- The order's Finish summary is `7: Matte; 8: Glossy`, without a duplicate Matte from the split shipment.
- Both mode: one workbook with the one-row Order Level table and three-row Shipment Level table. All three detail rows have the same Order Key as their parent. View Order resolves to order 100; View Shipments resolves to its first detail row.

## Global constraints

- API field: `reportLevel`; supported values: `order`, `shipment`, and `both`; omitted value defaults to `shipment`.
- Keep the existing Express/CommonJS/vanilla JavaScript stack; allow one pinned ExcelJS dependency for workbook export.
- Preserve existing Shipment Level column names, ordering, and row behavior.
- Order Level produces exactly one row per distinct source order, including orders with no items or shipments.
- Dynamic keys come from source data; no hardcoded option names or positional value interpretation.
- Build totals from original orders/items/shipments, never from already-expanded report rows.
- Both tables must come from one source fetch/enrichment pass with identical store/date/status filters.
- Excel export always includes matching, nonsecret Order Key columns; every detail row must resolve to exactly one parent order.
- Treat `MAX_REPORT_ROWS` as the combined output-row cap in Both mode; single modes keep their existing per-report cap.
- Planning only in this change; implement after review of these proposed defaults.
- Preserve the existing uncommitted dynamic-key changes; inspect their diff before staging task commits.

## Review focus

1. Split shipments and duplicate source references must not inflate ordered quantities, order totals, or item summaries. Covered in Tasks 2 and 3.
2. Successful empty responses and failed requests must remain distinguishable. Covered in Tasks 2 and 3.
3. Unknown shipped quantities must remain blank; valid zero must remain zero. Covered in Task 3.
4. New dynamic keys appearing late in the full result must be included in the exported header. Covered in Tasks 3 and 5.
5. Missing/duplicate parent keys, sorting, hidden relationship columns, and simultaneous exports must not break links or mix tables. Covered in Tasks 4, 5, 6, and 7.

## File responsibilities

| File | Planned responsibility |
|---|---|
| `config/report.js` | Per-level schemas, core columns, groups, and shared level validation |
| `services/orderService.js` | Validate request level and deduplicate Order Level source orders |
| `lib/brightSites.js` | Opt-in error propagation for order enrichment |
| `services/reportFields.js` (new) | Shared contact/amount/item-detail helpers and shipment item aggregation |
| `services/orderRowBuilder.js` (new) | Pure construction of one order summary and its dynamic details |
| `services/reportRowBuilder.js` | One enrichment pass, mode dispatch, row keys, and coordinated table results |
| `services/reportJobService.js` | Persist mode in jobs/history, pass mode through, publish correct schema |
| `routes/storeRoutes.js` | Return the column catalog for the selected level |
| `public/reportView.js` (new) | Shared pure column-selection and dynamic-splitting transformations |
| `services/workbookExportService.js` (new) | Excel tables, typed cells, key validation, and cross-tab navigation |
| `routes/reportRoutes.js` | Authenticated Excel download from a completed Both-mode job |
| `public/index.html` | Selector, preview tabs, applicable controls, separate preferences, and downloads |
| `package.json`, `package-lock.json` | Pinned ExcelJS dependency |
| Existing/new tests and `README.md` | Verify contracts and explain both row types |

## Implementation tasks

### Task 1: Define schemas and request contracts

**Files:** Modify `config/report.js`, `services/orderService.js`, `routes/storeRoutes.js`, `test/orderService.test.js`; create `test/reportConfig.test.js`, `test/columnRoutes.test.js`.

**Interfaces:** Export `normalizeReportLevel(value) -> 'order' | 'shipment' | 'both'` and `getReportColumnConfig(reportLevel = 'shipment') -> { columns: string[], core: string[], groups: { label, columns }[] }`. Preserve existing constants for legacy callers. `validateRunRequest(body)` adds `reportLevel` to its existing return object. `GET /api/columns?reportLevel=order|shipment` keeps the existing `{ groups, core }` response shape.

- [x] Write tests asserting omitted mode equals `shipment`, explicit `order` and `both` are accepted, and unsupported/empty/non-string modes return HTTP 400. Test the unsupported Order Level/UPS combination and the supported Both/UPS combination. Catalogs still accept only concrete levels (`order` or `shipment`); test that requesting a `both` catalog returns HTTP 400. Assert the Order Level catalog contains summary fields and excludes Unit Price/Line Item ID; assert the Shipment Level catalog matches the existing schema. Exercise the actual columns route for both modes and invalid input.
- [x] Run `node --test test/orderService.test.js test/reportConfig.test.js test/columnRoutes.test.js`; observe expected failures for missing contracts.
- [x] Implement the exact mode names, schema/core/groups from the design brief, and catalog route validation. Reuse one level normalizer in the request validator and catalog route.
- [x] Run those tests to green, then `npm test`; resolve failures before proceeding.
- [x] Commit only Task 1 files with `feat: define order and shipment report levels`.

### Task 2: Share source helpers and make Order Level enrichment reliable

**Files:** Modify `lib/brightSites.js`, `services/orderService.js`, `services/reportRowBuilder.js`, `test/orderService.test.js`, `test/reportRowBuilder.test.js`; create `services/reportFields.js`, `test/brightSites.test.js`.

**Interfaces:** Export `makeOrderKey(storeSubdomain, order) -> string`, using `encodeURIComponent(storeSubdomain) + ":" + encodeURIComponent(String(apiLookupId))`, where the lookup ID follows the identifier rule above. Never use credentials or token-bearing configuration keys as workbook identifiers. Move `buildStructuredContactFields(order)`, `extractOrderAmounts(order)`, `buildRowDetails(lineItem)`, and `aggregateShipmentLineItems(shipment)` into `services/reportFields.js` without changing their signatures or output. Preserve the existing `extractOrderAmounts` re-export from `reportRowBuilder.js`. Loaders retain `loadOrder(orderId, opts)`, `loadLineItems(orderId, opts)`, and `loadShipments(orderId, opts)` and accept `opts.failOnError`. `getRunContext(body, options)` uses the validated level for deduplication and adds `reportLevel` to its existing return object.

- [x] Add source-order tests: duplicate order IDs produce one source order in Order Level/Both; matching order IDs from different subdomains produce different keys; missing canonical identity rejects the report. Add loader tests: a successful empty line-item response returns `[]`; failed requests throw with `failOnError: true`; the default loader fallback remains unchanged. Stub external HTTP responses, not the formatting/aggregation code.
- [x] Run `node --test test/orderService.test.js test/brightSites.test.js test/reportRowBuilder.test.js`; observe failures for new behavior.
- [x] Implement Order Level deduplication, opt-in loader error propagation, and the helper extraction. Keep the current shipment builder using those same helpers. Use strict enrichment for Order Level and Both mode when wiring Task 4.
- [x] Run targeted tests and `npm test`. Verify existing shipment-row, pricing, tax, and dynamic-key assertions still pass.
- [x] Commit only Task 2 files with `refactor: share report fields and preserve enrichment errors`.

### Task 3: Build one row per order from source records

**Files:** Create `services/orderRowBuilder.js`, `test/orderRowBuilder.test.js`; consume Task 1 configuration and Task 2 shared helpers.

**Interfaces:** Export `buildOrderReportEntry({ order, line_items = [], shipments = [] }) -> { row: any[], rowDetails: { personalization: [string, string][], options: [string, string][] } }`. Its row follows `getReportColumnConfig('order').columns`. This builder is pure and performs no API requests.

- [x] Write tests using the acceptance case: exactly one entry, quantities 5/5, two distinct items, two shipments, Order Total 125.00, and Finish detail `7: Matte; 8: Glossy`. Add fixtures for repeated shipment references, two item IDs sharing a SKU, empty collections, missing/invalid/zero quantities, multiple tracking numbers, unordered shipment dates, and a new key appearing on a later item. Assert totals from the original order remain unchanged even when it has three shipment/item rows.
- [x] Run `node --test test/orderRowBuilder.test.js`; observe expected failures.
- [x] Implement grouping by original item/shipments, the summary rules, source-order money fields, item-associated summary strings, and dynamic details. Deduplicate only repeated IDs/references; preserve separate shipments and items that legitimately share a SKU or tracking number.
- [x] Run the new tests and `npm test`; confirm quantity rules and row widths match the schema.
- [x] Commit Task 3 files with `feat: build one-row order summaries`.

### Task 4: Build both tables from one job and one enrichment pass

**Files:** Modify `services/reportRowBuilder.js`, `services/reportJobService.js`, `test/reportRowBuilder.test.js`, `test/reportJobService.test.js`; update `services/diagnostics.js` if history formatting needs the new mode/counts.

**Interfaces:** Export `buildReportTables({ orders, storeOpts, reportLevel = 'shipment', ...existingOptions }) -> { tables, debugInfo }`, where `tables` contains the requested `order` and/or `shipment` entries. Each table is `{ columns, rows, rowDetails, rowKeys }`; `rowKeys` is a string array aligned with rows. Retain `buildReportRows(options)` as a compatibility wrapper for concrete single levels. Persist `request.reportLevel`, history mode, and per-table row counts. Single-level results retain `{ columns, rows, rowDetails, meta }`, with additive `rowKeys` and `meta.reportLevel`. Both results are `{ tables: { order, shipment }, meta }`; `meta` includes `reportLevel: 'both'`, unique orders, combined rows, and `rowCounts: { order, shipment }`.

- [x] Write integration tests: the acceptance fixture produces one order row and three detail rows in one Both-mode result, all with matching keys. Assert each order/item/shipment loader runs once per source order, rather than once per table. Assert source errors fail Both mode, omitted mode preserves legacy results, empty Both mode retains two schemas, and different concurrent job modes remain independent. Test maxRows against the sum of the two output row counts, cancellation during either builder, and UPS enriching only the shipment table.
- [x] Run `node --test test/reportRowBuilder.test.js test/reportJobService.test.js`; observe expected failures.
- [x] Enrich once, then dispatch the requested builders over the same records. In Both mode, skip the current eager `buildDebugInfo` network fetch in `getRunContext`; derive debug information from the already enriched first order instead. Assign keys using Task 2's `makeOrderKey`, preserving row-key/detail alignment. Publish both tables atomically; apply shared limits before retaining the result. Use each table's returned columns instead of forcing `ALL_COLUMNS` in the job service.
- [x] Run targeted tests and `npm test`; verify retention, cancellation, metadata, source-call counts, and existing UPS tests pass.
- [x] Commit only Task 4 files with `feat: build paired order and shipment reports`.

### Task 5: Share view transformations and add Both-mode controls

**Files:** Create `public/reportView.js`, `test/reportControls.test.js`; modify `public/index.html`, `test/reportView.test.js`, `README.md`.

**Interfaces:** Export browser/CommonJS `buildTableView(table, { deselectedColumns = [], splitPairs = false }) -> { columns, rows, rowKeys }`, with row order/key alignment preserved. Keep Danielle's standalone mapping in its existing wrapper. Selector ID `reportLevel`; option values `shipment`/`order`/`both`, labels `Shipment Level`/`Order Level`/`Both tables (Excel)`. Run includes `reportLevel`. Each concrete table requests its own column catalog. Save last mode under `brightsites_report_level_v1`; preserve `brightsites_deselected_columns_v2` for shipment preferences and use `brightsites_deselected_columns_order_v1` for orders.

- [x] Write tests for payload mode/default, separate saved preferences, a disabled selector during active jobs, mode changes clearing stale results, and Both-mode preview tabs sharing one completed job. Assert active-tab switching does not fetch BrightSites or discard the other table. Test dynamic keys on row 51, missing-key blank cells, source-row/key alignment after column selection, and preview/CSV consistency. Assert Danielle is disabled in Both/Order mode and UPS is available in Both mode.
- [x] Run `node --test test/reportView.test.js test/reportControls.test.js`; observe expected failures.
- [x] Extract the existing generic view transformation into the shared module and use it in the browser. Add mode-aware controls, two previews/column pickers in Both mode, separate preferences, and one Download Excel button. Its request supplies both tables' column selections and split settings. Reject stale catalog requests after rapid mode changes. Single-level CSV names remain `brightsites_orders.csv` / `brightsites_shipments.csv`.
- [x] Run targeted tests and `npm test`; manually confirm both preview tabs and separate selections work. Document the three modes and workbook relationship.
- [x] Commit only Task 5 files with `feat: preview paired report tables`.

### Task 6: Export linked native Excel tables

**Files:** Add pinned ExcelJS to `package.json`/`package-lock.json`; create `services/workbookExportService.js`, `test/workbookExportService.test.js`, `test/workbookRoutes.test.js`; modify `routes/reportRoutes.js`.

**Interfaces:** Export `exportReportWorkbook({ tables, selections }) -> Promise<Buffer>` from the workbook service. `tables` are Task 4's server-held Order/Shipment tables; `selections` are `{ order: { columns: string[], splitPairs: boolean }, shipment: { columns: string[], splitPairs: boolean } }`. An omitted selection uses all columns without splitting. Implement `POST /api/run/:jobId/workbook` for completed Both-mode jobs, returning the XLSX MIME type and attachment filename `brightsites_orders_and_shipments.xlsx`. Validate selections against server-held column catalogs; request bodies supply settings, never rows, formulas, or link targets. Return 400 for unsupported settings/single-level jobs, 404 for unknown jobs, 409 for unfinished/canceled jobs, 410 for expired results, and 500 for failed jobs. Reuse existing authentication.

- [x] Write export round-trip tests that reopen the generated buffer: assert worksheet/table names, one parent/three child rows, exact shared text keys, required key/link columns even when all optional columns are deselected, dynamic headers, numeric money/quantities, and literal formula-like source text. Validate duplicate parents and orphan children reject export. Inspect key-based hyperlink/count formulas and cached initial values against independently derived expectations. Cover empty workbooks and parent orders with no detail rows without invalid table references.
- [x] Write route tests for attachment headers, completion/result errors, invalid selections, unauthenticated access, and one export at a time. Confirm Excel export causes no additional BrightSites requests and no XLSX buffer is retained after the response.
- [x] Run `node --test test/workbookExportService.test.js test/workbookRoutes.test.js`; observe expected failures.
- [x] Install/pin the verified ExcelJS release. Implement the two sheets/tables and typed cells from the workbook design. Use `buildTableView` from Task 5 before injecting mandatory key/navigation/count columns. Validate the parent-child keys before serializing. Build all formulas from fixed templates referencing Order Key cells and named table columns; handle empty tables explicitly. Request recalculation and cache initial results.
- [x] Run targeted tests and `npm test`. Verify buffer reload works and source text does not become an executable formula or external link.
- [x] Commit only Task 6 files with `feat: export linked order and shipment Excel tables`.

### Task 7: Verify the paired export in Excel and complete documentation

**Files:** Modify `README.md` and the owning test files only where verification reveals supported repairs.

**Interfaces:** The final workbook implements the design's two tabs, one-to-many Order Key relationship, navigation links, count formulas, typed cells, and independently selected dynamic columns. It is a snapshot of one completed report job; navigation/count formulas recalculate inside that snapshot.

- [x] Run `npm test` and `git diff --check`; both must pass. Verify all single-mode regressions as well as paired export tests.
- [x] Run Both mode on a date range containing split shipments, unshipped items, multiple options, and an order with no shipments. Compare both previews and the workbook against the same source fixture, including quantities, distinct tracking numbers, and order totals counted once.
- [x] Open the saved workbook in Microsoft Excel. Verify both native tables/filter controls, frozen headers, no repair warning, readable columns, both link directions, and no formula errors. Sort the tables independently, recalculate, and confirm key-based links/counts still resolve. Filter Shipment Level by an Order Key and verify all related detail rows. Test the empty-results workbook. If Excel is unavailable, document which native checks remain unverified rather than treating a successful file parse as proof.
- [x] Measure a representative large Both-mode export against the configured row cap and deployed memory budget. If it exceeds the budget, lower the workbook row cap with an explicit error before release; do not truncate one table or drop relationship keys to make it fit.
- [x] Finalize README with the three modes, linkage/filtering behavior, snapshot semantics, formula recalculation, and Shipment-only Danielle formatting. Include the acceptance case and how one order links to several detail rows.
- [x] Review the complete diff and commit documentation/test repairs with `docs: explain paired Excel reports and linkage`.

## Plan self-review and handoff

The seven tasks cover the three query modes, one-pass source aggregation, dynamic keys, paired result contracts, UI previews, linked XLSX tables, and native Excel verification. All seven tasks are complete. A fresh reviewer examined the full implementation; identified issues were reproduced with failing tests and fixed before the final passing suite.

The implementation remains on the local feature branch pending an integration or deployment decision.
