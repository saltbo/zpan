ALTER TABLE `download_tasks` ADD `info_hash` text;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `torrent_id` text;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `torrent_cache_role` text;--> statement-breakpoint
CREATE INDEX `download_tasks_torrent_idx` ON `download_tasks` (`torrent_id`,`status`);--> statement-breakpoint
ALTER TABLE `torrent_files` ADD `uploaded_at` integer;