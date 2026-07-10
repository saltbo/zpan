CREATE TABLE `stats_rollups_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_start` integer NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`metric_key` text NOT NULL,
	`dimension_key` text DEFAULT '' NOT NULL,
	`dimension_value` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`unique_count` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stats_rollups_daily_bucket_metric_dim_uniq` ON `stats_rollups_daily` (`bucket_start`,`org_id`,`metric_key`,`dimension_key`,`dimension_value`);--> statement-breakpoint
CREATE INDEX `stats_rollups_daily_metric_bucket_idx` ON `stats_rollups_daily` (`metric_key`,`bucket_start`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`target_name` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`actor_type` text,
	`actor_ref` text
);
--> statement-breakpoint
INSERT INTO `__new_activity_events`("id", "org_id", "user_id", "action", "target_type", "target_id", "target_name", "metadata", "created_at", "actor_type", "actor_ref") SELECT "id", "org_id", "user_id", "action", "target_type", "target_id", "target_name", "metadata", "created_at", NULL, NULL FROM `activity_events`;--> statement-breakpoint
DROP TABLE `activity_events`;--> statement-breakpoint
ALTER TABLE `__new_activity_events` RENAME TO `activity_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_events_org_created_idx` ON `activity_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_user_created_idx` ON `activity_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_action_created_idx` ON `activity_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_target_created_idx` ON `activity_events` (`target_type`,`target_id`,`created_at`);
