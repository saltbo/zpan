ALTER TABLE `stats_rollups_daily` RENAME TO `stats_rollups_hourly`;--> statement-breakpoint
DROP INDEX `stats_rollups_daily_bucket_metric_dim_uniq`;--> statement-breakpoint
DROP INDEX `stats_rollups_daily_metric_bucket_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `stats_rollups_hourly_bucket_metric_dim_uniq` ON `stats_rollups_hourly` (`bucket_start`,`org_id`,`metric_key`,`dimension_key`,`dimension_value`);--> statement-breakpoint
CREATE INDEX `stats_rollups_hourly_metric_bucket_idx` ON `stats_rollups_hourly` (`metric_key`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `stats_rollups_hourly_dimension_bucket_idx` ON `stats_rollups_hourly` (`metric_key`,`dimension_key`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `activity_events_created_idx` ON `activity_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `background_jobs_created_idx` ON `background_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `cloud_traffic_reports_updated_idx` ON `cloud_traffic_reports` (`updated_at`);--> statement-breakpoint
CREATE INDEX `download_tasks_created_idx` ON `download_tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `download_tasks_finished_idx` ON `download_tasks` (`finished_at`);--> statement-breakpoint
CREATE INDEX `matters_status_dir_created_idx` ON `matters` (`status`,`dirtype`,`created_at`);--> statement-breakpoint
CREATE INDEX `remote_download_usage_created_idx` ON `remote_download_usage_reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `shares_created_idx` ON `shares` (`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_processed_idx` ON `webhook_events` (`processed_at`);--> statement-breakpoint
CREATE INDEX `session_created_idx` ON `session` (`created_at`);--> statement-breakpoint
CREATE INDEX `user_created_idx` ON `user` (`created_at`);