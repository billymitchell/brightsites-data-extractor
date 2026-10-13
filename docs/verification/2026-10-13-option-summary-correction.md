# Personalization and Version correction

Production feedback identified two display problems: Order Level personalization included internal item-ID prefixes, and the earlier approved four-part Version example remained a single dynamic column.

The source read for Redemption order 2505 confirmed three actual Version values: `Plaque, 4 Star, 2026, Hotel`, `Plaque, Recommended, 2026, Restaurant`, and `Plaque, 4 Star, 2026, Spa`. The ID prefixes came from the order-summary builder, not BrightSites personalization values.

Order Level now joins distinct human-readable summary values without ID prefixes. Individual source items and quantities remain counted by item ID. Shipment Level retains per-item detail and the workbook relationship still uses Order Key. This also removes ID prefixes from Product Name and SKU summaries.

The confirmed Version shape expands into Product Type, Award Level, Year and Category in structured row details. The split preview, CSV and Excel share those fields. Other named option keys still create columns dynamically, and unrecognized Version formats remain intact. Both Order and Shipment Level retain the original Version text when splitting is off.

Regression tests were observed failing before the correction. The full suite then passed: 71 tests, zero failures. Coverage includes the supplied establishment-name example, duplicate summary values without collapsing distinct items, structured/text/keyed Version formats, malformed Version values, newly named keys alongside Version fields, and original unsplit text.

Live source verification rebuilt Order/Both tables for order 2505: one order row and three detail rows. Both views included the four Version columns and clean establishment names. A generated workbook was reopened with ExcelJS and both sheets had the expected Version headers. `git diff --check` was clean.

Existing completed jobs and downloaded files are snapshots. After deployment, reload the app and run a fresh report with the split option enabled for each desired table.
