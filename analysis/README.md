# Dynasty Bois audit refresh

The site has two linked views:

* `/audit`: saved Orlando/league summaries, roster and pick changes, market trends, and matching summary Excel/PDF downloads. Each successful pass receives an immutable snapshot ID.
* `/audit/research`: all 80 league-scoped tables from the original research engine, searchable and paginated, with full Excel and PDF downloads and table changes since the previous pass.

The original September 23 files in `public/audit` are explicitly dated reference material. They are not represented as a successful fresh publication.

## Rebuild

Install `analysis/requirements.txt` and the root npm dependencies. Then run:

```sh
python analysis/run.py --work-dir /tmp/portfolio --output-dir /tmp/audit --previous public/audit/source-tables.json.gz
python analysis/publish.py /tmp/audit
```

Publication requires `AUDIT_INGEST_TOKEN`, a dedicated random credential configured on both Vercel and GitHub Actions. It sends only the three validated, league-scoped output files to the existing dashboard. There are no public GitHub releases or additional hosting services. Upload chunks remain unpublished until all sizes and SHA-256 checksums match and the bundle validates.

The workflow runs at the 8 a.m. America/New_York schedule, selecting the appropriate UTC cron for daylight saving time. Scheduler queues and rebuild time mean publication is after the scheduled start, not guaranteed at exactly 8:00. The visible page checks for completed passes every minute. Failure retains the previous published audit.

`--cached` is only a local regression mode. Its manifest cannot pass the publication gate.

## Data scope and limits

The inherited engine fetches the portfolio inputs it needs for historical comparisons, then exports only the Dynasty Bois view. Its player/league ID baseline is the 2026 season. It deliberately stops at annual rollover until the league IDs and seasonal baselines are reviewed. College profiles retain the dated August 19, 2026 reference baseline. Historical trend tables and recommendations are recalculated from the available evidence; they are descriptive, not causal claims.

Summary values use the website's market data. Research values preserve the original FantasyCalc/DynastyProcess analysis. These sources use different scales and should not be mixed as if they were the same valuation.

The PDF includes every analytical result table; detailed raw datasets are available in the full Excel workbook and website. Row numbers let readers match records across wide PDF column groups.

Each complete research pass currently uses about 3.4 MB of database storage. Complete history is retained; no existing history is automatically deleted. Provision storage and compute capacity accordingly.

## Verification and activation status, September 23, 2026

The fresh-source run completed with 80 tables and 13,122 data rows. The workbook has 81 sheets including README. The revised PDF has 134 pages. Publication format/checksum tests, projection tests, lint, TypeScript and a production build passed. A Vercel preview build also succeeded.

Production database requests are currently rejected with PostgreSQL code 53000 / Prisma P2039: account or project quota exceeded. Production publication and the first stored audit must wait for database service to be restored and end-to-end checks to pass. The new workflow must be present on the default branch to run on its daily schedule.

Projection fixes preserve current-week selection, feed-failure retention, roster-scoped freshness checks, kickoff locking and completion-gated grading. Forecast simulations consume the canonical current-week projections and withhold insufficient-coverage results. Core league scoring is applied; uncommon bonus/return/two-point events are not consistently present in both projection feeds and are disclosed on the projections page. These are not claimed as fully modeled scoring events.
