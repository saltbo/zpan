ALTER TABLE `download_tasks` ADD `resolve_started_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `resolve_completed_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `download_completed_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `ingest_started_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `ingest_completed_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `seeding_started_at` integer;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `seeding_stopped_at` integer;