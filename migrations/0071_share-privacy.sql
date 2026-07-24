DROP INDEX `shares_creator_listed_idx`;--> statement-breakpoint
ALTER TABLE `shares` ADD `private` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `shares_creator_private_created_idx` ON `shares` (`creator_id`,`private`,`created_at`);--> statement-breakpoint
ALTER TABLE `shares` DROP COLUMN `listed_at`;