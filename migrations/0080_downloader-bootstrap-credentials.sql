CREATE TABLE `downloader_bootstrap_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`device_code` text NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloader_bootstrap_credentials_token_hash_unique` ON `downloader_bootstrap_credentials` (`token_hash`);--> statement-breakpoint
CREATE INDEX `downloader_bootstrap_token_hash_idx` ON `downloader_bootstrap_credentials` (`token_hash`);--> statement-breakpoint
CREATE INDEX `downloader_bootstrap_user_idx` ON `downloader_bootstrap_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `downloader_bootstrap_consumed_idx` ON `downloader_bootstrap_credentials` (`consumed_at`);