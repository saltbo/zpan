CREATE TABLE `media_scrapes` (
	`matter_id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`library_id` text NOT NULL,
	`status` text NOT NULL,
	`tmdb_type` text,
	`tmdb_id` integer,
	`season` integer,
	`episode` integer,
	`language` text NOT NULL,
	`source` text NOT NULL,
	`match_key` text NOT NULL,
	`file_updated_at` integer NOT NULL,
	`scraped_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `media_libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_scrapes_library_idx` ON `media_scrapes` (`library_id`);