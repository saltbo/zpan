# Admin analytics

## Storage model

Admin analytics has one derived table: `stats_rollups_hourly`. Every bucket starts on a UTC hour. The server has no configured reporting time zone and does not persist daily aggregates or time-zone-specific rows.

Each row is identified by UTC bucket, organization, metric, dimension, and dimension value. Metric and dimension combinations must be declared in `server/domain/admin-stats-metrics.ts`. Counters are additive; gauges are point-in-time snapshots; distinct values must never be added across buckets.

The ten-minute scheduler rebuilds the current and previous UTC hours. Rebuilding an hour deletes and inserts that hour atomically, so retries are safe. A `stats.rollup_run` marker means the counter rows for an hour are complete. Snapshot rows are finalized near the next hour and remain useful as waterlines, not event totals.

## Query model

The client sends an IANA time zone with its selected range. Date-only inputs are interpreted as local calendar dates in that zone, including daylight-saving transitions and non-whole-hour offsets.

Queries combine:

- complete UTC hours from `stats_rollups_hourly`;
- raw rows for the current partial hour, incomplete hours, and partial hours cut by the requested boundary;
- raw rows for a UTC hour that crosses a local-day boundary, such as `Asia/Kathmandu` at `:15` UTC.

This preserves exact local-day results without storing a daily table. A missing completion marker always fails back to the raw source instead of returning a partial aggregate.

Exact DAU, WAU, and MAU remain a deliberate exception because hourly distinct counts cannot be added. Current inventory, quota pressure, active jobs, downloader status, and active shares are also queried live because they describe current state rather than historical event volume.

## Metric semantics

- Upload bytes mean successfully confirmed upload bytes.
- Download bytes and counts mean issued downloads, not client-completed transfers.
- Cloud traffic report status describes metering synchronization and belongs to Operations, not download success.
- Files older than 90 days are an age cohort, not cold data; access recency is not inferred.
- Sharing views, downloads, and saves are independent event totals, not a user-level funnel.

Rows with transfer events but no recoverable byte count carry `quality=lower_bound`. The `stats.quality_missing_bytes` metric exposes the affected event count by direction and source.

## Backfill and validation

Run `pnpm stats:backfill -- --apply ...` after the migration in each environment. The script first recovers audit metadata where an exact source still exists, then rebuilds historical hourly counters with conflict-aware updates. Re-running the same script produces no data changes.

Validation must reconcile raw event totals with hourly rows, verify completion markers, report missing transfer byte metadata, and compare dashboard responses for a UTC range, a DST date, and a non-whole-hour time zone.
