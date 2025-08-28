# BrightSites CSV Exporter

Simple Express + vanilla JS app to fetch BrightSites data and produce a CSV in the exact required schema.

Quick start

1. Copy `.env.example` to `.env` and fill `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN`.
2. Install and run:

```bash
npm install
npm start
```

3. Open http://localhost:3000 and choose options, Run, then Download CSV.

Notes
- The server uses `BRIGHTSITES_SUBDOMAIN` and `BRIGHTSITES_API_TOKEN` to build requests to BrightSites API (v2.6.1). 
- CSV headers are intentionally spelled exactly (includes the misspelling "Shipping Landded Cost").
- The server paginates using `page` and `per_page` and will stop when a page returns fewer results than `per_page`.
