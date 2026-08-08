ALTER TABLE `download_tasks` ADD `requested_by_actor_type` text;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `requested_by_actor_ref` text;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `requested_by_actor_issuer` text;--> statement-breakpoint
ALTER TABLE `matters` ADD `created_by_actor_type` text;--> statement-breakpoint
ALTER TABLE `matters` ADD `created_by_actor_ref` text;--> statement-breakpoint
ALTER TABLE `matters` ADD `created_by_actor_issuer` text;