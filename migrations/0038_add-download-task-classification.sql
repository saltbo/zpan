ALTER TABLE `download_tasks` ADD `category` text;--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `tags` text DEFAULT '[]' NOT NULL;