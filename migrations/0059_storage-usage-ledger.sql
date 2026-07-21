CREATE TABLE `storage_usage_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`event_key` text NOT NULL,
	`org_id` text NOT NULL,
	`storage_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`delta_bytes` integer NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_usage_ledger_event_key_unique` ON `storage_usage_ledger` (`event_key`);--> statement-breakpoint
CREATE INDEX `storage_usage_ledger_occurred_idx` ON `storage_usage_ledger` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `storage_usage_ledger_org_occurred_idx` ON `storage_usage_ledger` (`org_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `storage_usage_ledger_storage_occurred_idx` ON `storage_usage_ledger` (`storage_id`,`occurred_at`);--> statement-breakpoint
DROP INDEX `image_hostings_org_path_uniq`;--> statement-breakpoint
ALTER TABLE `image_hostings` ADD `purged_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `image_hostings_org_path_uniq` ON `image_hostings` (`org_id`,`path`) WHERE "image_hostings"."purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE `matters` ADD `purged_at` integer;