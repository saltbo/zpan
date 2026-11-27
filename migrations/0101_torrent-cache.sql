CREATE TABLE `torrent_cache_configs` (
	`org_id` text PRIMARY KEY NOT NULL,
	`folder` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `torrent_files` (
	`torrent_id` text NOT NULL,
	`file_idx` integer NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text NOT NULL,
	PRIMARY KEY(`torrent_id`, `file_idx`),
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_files_storage_object_uniq` ON `torrent_files` (`storage_id`,`object_key`);--> statement-breakpoint
CREATE TABLE `torrents` (
	`id` text PRIMARY KEY NOT NULL,
	`info_hash` text NOT NULL,
	`storage_id` text NOT NULL,
	`name` text NOT NULL,
	`total_size` integer NOT NULL,
	`file_count` integer NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`verified` text,
	`source_task_id` text,
	`source_downloader_id` text,
	`last_accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrents_info_hash_unique` ON `torrents` (`info_hash`);--> statement-breakpoint
CREATE INDEX `torrents_status_accessed_idx` ON `torrents` (`status`,`last_accessed_at`);--> statement-breakpoint
CREATE INDEX `torrents_storage_idx` ON `torrents` (`storage_id`);--> statement-breakpoint
CREATE INDEX `matters_storage_object_idx` ON `matters` (`storage_id`,`object`);