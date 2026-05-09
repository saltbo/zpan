CREATE TABLE `cloud_traffic_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`period` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`event_id` text NOT NULL,
	`bytes` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_traffic_reports_event_uniq` ON `cloud_traffic_reports` (`event_id`);--> statement-breakpoint
CREATE INDEX `cloud_traffic_reports_org_period_idx` ON `cloud_traffic_reports` (`org_id`,`period`);--> statement-breakpoint
CREATE INDEX `cloud_traffic_reports_status_idx` ON `cloud_traffic_reports` (`status`);