# Report table levels acceptance record

Implemented the [approved plan](../superpowers/plans/2026-10-13-report-table-levels.md) on `feature/report-table-levels`.

## Verification

- Full final suite: 67 tests passed, zero failures (`npm test`). Includes default/single modes, paired jobs, strict source failures, cancellation/limits, dynamic keys, independent UI preferences, UPS scope, protected HTTP downloads, literal cells, native XLSX tables and empty results.
- `git diff --check`: clean. `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities. ExcelJS remains pinned to 4.4.0, with its compatible UUID dependency overridden to 11.1.1.
- Local fixture browser flow: selected Both mode, ran one job, inspected two order rows and three shipment rows, switched previews without another run, enabled independent dynamic splitting, observed Finish/New Key columns and downloaded the completed XLSX attachment. No production credentials or live customer queries were used.
- Microsoft Excel: populated workbook opened without a repair warning; native tables, filters, frozen headers and typed values present. Both link directions resolved by Order Key after sorting the order table; shipment table then sorted independently and its parent link still resolved. Filtering Shipment Level to `fixture:100` showed all three related rows (3 of 4 fixture detail rows). Cached counts recalculated correctly. An order with no items retained a parent row and zero detail count. Empty workbook opened cleanly with two header-only sheets and no fabricated rows.
- Native verification found that shorthand `[@[Order Key]]` serialization caused Excel to remove formulas during repair. Fixed serialization uses canonical OOXML `TableName[[#This Row],[Order Key]]` references; automated regression and a clean native open verified the repair.
- Isolated memory benchmark: 336 orders plus 1,344 shipment rows, approximately 97,776 cells. The original roughly 244,000-cell benchmark peaked near 501 MiB; the smaller representative benchmark peaked near 249 MiB before final styling changes. Default export caps are 10,000 combined rows and 100,000 cells, checked before expanded row allocation. This is an isolated export measurement, not a guarantee for a server retaining several jobs.

## Final review repairs

A fresh reviewer examined the baseline-to-feature diff and ran isolated repros. All five actionable findings were treated as Important because they could lose source data, exhaust memory, overwrite selection preferences, or display wrong financial/date values. Each had a failing regression test before the fix and a passing full suite afterwards:

1. Multi-status Order/Both queries now use canonical API identifiers and reject unidentified records before deduplication can discard them.
2. Dynamic columns and combined cell counts are discovered before materializing the rows-by-keys matrix.
3. Column actions are disabled while the active catalog loads; stale checkbox events cannot update another table's preferences.
4. Source shipping cost zero takes priority over nonzero fallback amounts.
5. Invalid calendar shipment dates are excluded before computing valid date extrema.

No review findings were deferred. Native workbook checks were performed by the implementer; the reviewer did not repeat them independently.

## Execution decisions

1. Used a feature branch in the existing checkout instead of a separate worktree to preserve the approved prior fixes and IDE workspace. Cost if wrong: changes were visible in the current working directory during implementation.
2. Committed schema and shared-field tasks together because their validation/enrichment contracts were verified together. Cost if wrong: a larger review unit.
3. Corrected date-only display to retain the source calendar date, avoiding the previous-day shift in New York. Cost if wrong: date-only displays differ from previous exports.
4. Added a cell cap alongside the row cap after the memory benchmark. Cost if wrong: wide exports may require fewer selected columns or a narrower date range.

The work is local; no merge, push or deployment was performed.
