CREATE TABLE `stremthru_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text NOT NULL,
	`torrent_file_id` text NOT NULL,
	`url` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_file_id`) REFERENCES `torrent_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stremthru_links_user_file_uniq` ON `stremthru_links` (`user_id`,`torrent_file_id`);--> statement-breakpoint
CREATE INDEX `stremthru_links_expires_idx` ON `stremthru_links` (`expires_at`);