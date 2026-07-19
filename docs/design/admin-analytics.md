# Admin analytics

## Boundary

Admin analytics separates operational facts from queryable results:

- Operational tables such as `activity_events`, `shares`, `matters`, `org_quotas`, jobs, tasks, and webhook/report tables are rollup inputs. Dashboard requests never query or aggregate these tables.
- `stats_rollups_hourly` is the only dashboard result store. Every bucket starts on a UTC hour.
- The current open UTC hour is never visible. A result becomes queryable only after the background rollup commits the hour and its completion marker atomically.
- The browser only renders server-returned values. Rates, deltas, percentages, alerts, rankings, and data-quality totals are computed by the server from result rows.

The dashboard is read-only and does not support report or CSV export.

## Fact writes

Metrics derived from activity facts use a validated producer contract. New transfer and sharing facts fail fast when required fields such as `bytes`, `source`, `trafficEventId`, or `shareId` are missing. Historical rows that predate this contract remain diagnosable through quality metrics.

A deduplicated share view updates `shares.views` and inserts its `share_view` fact in one database transaction. Download flows record an issued fact only after quota/metering and presigning succeed; a failed fact records the stable reason and traffic event id. If the issued-fact write fails, the flow refunds the counters it already reserved.

## Result writes

Metric and dimension combinations are declared in `server/domain/admin-stats-metrics.ts`:

- Counters are additive event totals for a closed hour.
- Gauges are point-in-time snapshots written for that hour's close.
- High-volume source rows are grouped by the database before the Worker builds result rows; the scheduler does not load a whole hour of raw events into memory.

The ten-minute scheduler always rebuilds the latest closed UTC hour with counters and snapshots. It also checks the previous 48 hours and repairs at most three missing counter buckets per run. Historical repair does not invent old snapshots from current state.

Each row and `stats.rollup_run` marker carries:

- the rollup schema version;
- `scope=full` for counters plus snapshots, or `scope=counters` for a historical counter repair;
- `quality=exact` or `quality=lower_bound`.

A transaction deletes and reinserts the affected result scope, including its marker, so retries are idempotent. Readers reject old-version rows, rows without valid metadata, orphan rows without a compatible marker, and gauges backed only by a counter-repair marker.

## Query model

Dashboard ranges use UTC calendar boundaries only. Date-only input is normalized to complete UTC days; explicit timestamps must align to complete UTC hours. Ranges are limited to one year.

Each response includes result coverage:

- `complete`: every expected bucket has a compatible completion marker;
- `partial`: at least one compatible bucket exists, but one or more are missing;
- `empty`: no compatible result bucket exists;
- `dataThrough`: the exclusive end of the newest completed bucket.

Responses with period-over-period deltas also include `comparisonCoverage`. A delta is only
fully reconcilable when both the requested range and its comparison range are complete; the UI
shows either side's missing buckets instead of presenting a partial comparison as authoritative.

Event-only traffic coverage accepts `counters` and `full` markers. Views that depend on snapshots require `full` markers.

Request-time work is bounded and result-only. Charts and totals read only the aggregate dimensions they need; high-cardinality share dimensions are not loaded when querying totals. Top-share and top-space queries aggregate the result table and return at most eight ids; only those ids are hydrated from the operational tables for display names. No dashboard endpoint scans users, files, activities, shares, jobs, tasks, reports, or downloaders.

## Metric semantics

- Upload bytes mean successfully confirmed upload bytes.
- Download bytes and counts mean issued downloads, not client-completed transfers.
- Cloud traffic report status describes metering synchronization and belongs to Operations, not download success.
- User, storage, share lifecycle, active job/task, downloader, report, and webhook state comes from closed-hour snapshots, not live request-time reads.
- Storage inventory includes normal files and image-hosting objects.
- Files older than 90 days are an age cohort, not proven cold data; the UI labels this explicitly.
- Sharing views, downloads, and saves are independent event totals. Downloads/saves per 100 views are intensity ratios, not user-level conversion funnels.

Rows with transfer events but no recoverable byte count carry `quality=lower_bound`. `stats.quality_missing_bytes` exposes affected event counts by direction and source.

## Backfill and validation

Run `pnpm stats:backfill -- --apply ...` after the migration in each environment. The script repairs recoverable historical fact metadata, removes incompatible result versions, and rebuilds historical counters idempotently. It writes a continuous `scope=counters` marker for every closed UTC hour from the first available fact through the latest closed hour, including hours with zero activity, and rejects missing or open-hour markers during validation. Existing `scope=full` markers and snapshot rows remain intact.

The script does not fabricate historical inventory or active-user snapshots. Snapshot-backed views therefore report partial or empty coverage before full rollups began, while event-backed views can report complete historical coverage. Facts whose original byte size can no longer be recovered remain visible as `quality=lower_bound` instead of being guessed.

Validation must cover:

- fact-write contracts and atomic share-view writes;
- UTC range alignment and exclusion of the current open hour;
- rollup idempotency and database-side grouping;
- version and scope rejection, including counter-only versus full coverage;
- missing-bucket repair and lower-bound byte quality;
- dashboard endpoints never writing results or falling back to raw data;
- browser rendering without metric calculations.
