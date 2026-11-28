CREATE TABLE `torrent_stream_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`torrent_id` text NOT NULL,
	`first_piece` integer NOT NULL,
	`piece_count` integer NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_stream_chunks_torrent_first_uniq` ON `torrent_stream_chunks` (`torrent_id`,`first_piece`);--> statement-breakpoint
CREATE TABLE `torrent_stream_wants` (
	`id` text PRIMARY KEY NOT NULL,
	`torrent_id` text NOT NULL,
	`piece` integer NOT NULL,
	`wanted_at` integer NOT NULL,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_stream_wants_torrent_piece_uniq` ON `torrent_stream_wants` (`torrent_id`,`piece`);