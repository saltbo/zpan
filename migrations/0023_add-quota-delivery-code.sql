ALTER TABLE `quota_delivery_events` ADD `code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `quota_delivery_events_code_uniq` ON `quota_delivery_events` (`code`);