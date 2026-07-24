ALTER TABLE `shares` ADD `listed_at` integer;--> statement-breakpoint
CREATE INDEX `shares_creator_listed_idx` ON `shares` (`creator_id`,`listed_at`);