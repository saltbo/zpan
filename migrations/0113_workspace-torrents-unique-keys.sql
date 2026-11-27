DROP INDEX `stremthru_links_user_file_uniq`;--> statement-breakpoint
CREATE UNIQUE INDEX `stremthru_links_user_org_file_uniq` ON `stremthru_links` (`user_id`,`org_id`,`torrent_file_id`);--> statement-breakpoint
DROP INDEX `workspace_torrents_org_hash_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_torrents_org_hash_uniq` ON `workspace_torrents` (`org_id`,`info_hash`);