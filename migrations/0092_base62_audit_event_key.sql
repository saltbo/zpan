ALTER TABLE `audit_events` ADD `event_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_event_key_unique` ON `audit_events` (`event_key`);