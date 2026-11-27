CREATE TABLE `torrent_extra_objects` (
	`torrent_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	PRIMARY KEY(`torrent_id`, `name`),
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `torrent_extra_objects_storage_idx` ON `torrent_extra_objects` (`storage_id`);