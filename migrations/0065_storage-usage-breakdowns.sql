CREATE TABLE `storage_usage_breakdowns` (
	`org_id` text NOT NULL,
	`category` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_usage_breakdowns_org_category_uniq` ON `storage_usage_breakdowns` (`org_id`,`category`);--> statement-breakpoint
CREATE INDEX `storage_usage_breakdowns_org_idx` ON `storage_usage_breakdowns` (`org_id`);