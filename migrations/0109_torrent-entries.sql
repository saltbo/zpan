CREATE TABLE `torrent_files` (
	`id` text PRIMARY KEY NOT NULL,
	`torrent_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_idx` integer,
	`path` text,
	`layout_path` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text,
	`media` text,
	`uploaded_at` integer,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_files_torrent_idx_uniq` ON `torrent_files` (`torrent_id`,`file_idx`);--> statement-breakpoint
CREATE INDEX `torrent_files_torrent_layout_idx` ON `torrent_files` (`torrent_id`,`layout_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_files_storage_object_uniq` ON `torrent_files` (`storage_id`,`object_key`);