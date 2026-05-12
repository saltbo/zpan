CREATE TABLE `webdav_dead_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`resource_path` text NOT NULL,
	`namespace` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webdav_dead_properties_resource_prop_uniq` ON `webdav_dead_properties` (`org_id`,`resource_path`,`namespace`,`name`);--> statement-breakpoint
CREATE INDEX `webdav_dead_properties_resource_idx` ON `webdav_dead_properties` (`org_id`,`resource_path`);--> statement-breakpoint
CREATE TABLE `webdav_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`org_id` text NOT NULL,
	`resource_path` text NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`depth` text DEFAULT 'infinity' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webdav_locks_token_unique` ON `webdav_locks` (`token`);--> statement-breakpoint
CREATE INDEX `webdav_locks_resource_idx` ON `webdav_locks` (`org_id`,`resource_path`);--> statement-breakpoint
CREATE INDEX `webdav_locks_expires_idx` ON `webdav_locks` (`expires_at`);