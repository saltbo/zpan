ALTER TABLE `user` ADD `last_active_at` integer;--> statement-breakpoint
CREATE INDEX `user_lastActiveAt_idx` ON `user` (`last_active_at`);