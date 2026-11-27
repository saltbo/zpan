CREATE TABLE `workspace_torrents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`torrent_id` text,
	`info_hash` text,
	`source` text NOT NULL,
	`source_uri` text NOT NULL,
	`display_name` text,
	`task_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_by_actor_type` text NOT NULL,
	`created_by_actor_ref` text NOT NULL,
	`created_by_actor_issuer` text,
	`last_played_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`torrent_id`) REFERENCES `torrents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_torrents_org_torrent_uniq` ON `workspace_torrents` (`org_id`,`torrent_id`);--> statement-breakpoint
CREATE INDEX `workspace_torrents_org_created_idx` ON `workspace_torrents` (`org_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_torrents_org_hash_idx` ON `workspace_torrents` (`org_id`,`info_hash`);--> statement-breakpoint
CREATE INDEX `workspace_torrents_torrent_idx` ON `workspace_torrents` (`torrent_id`);--> statement-breakpoint
CREATE INDEX `workspace_torrents_task_idx` ON `workspace_torrents` (`task_id`);--> statement-breakpoint
CREATE INDEX `workspace_torrents_source_played_idx` ON `workspace_torrents` (`source`,`last_played_at`);--> statement-breakpoint
DROP TABLE `stremthru_links`;