CREATE TABLE `media_libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`fingerprint` text,
	`last_scanned_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_by_actor_type` text NOT NULL,
	`created_by_actor_ref` text,
	`created_by_actor_issuer` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_libraries_org_folder_uniq` ON `media_libraries` (`org_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `media_libraries_org_page_idx` ON `media_libraries` (`org_id`,`created_at`,`id`);