ALTER TABLE `download_tasks` ADD `events` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `download_tasks_org_deleted_created_idx` ON `download_tasks` (`org_id`,`deleted_at`,`created_at`);