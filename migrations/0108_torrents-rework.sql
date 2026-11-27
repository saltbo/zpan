ALTER TABLE `download_tasks` RENAME COLUMN "torrent_cache_role" TO "torrent_role";--> statement-breakpoint
DROP TABLE `torrent_cache_configs`;--> statement-breakpoint
DROP TABLE `torrent_extra_objects`;--> statement-breakpoint
DROP TABLE `torrent_files`;