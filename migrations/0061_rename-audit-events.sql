ALTER TABLE `activity_events` RENAME TO `audit_events`;--> statement-breakpoint
DROP INDEX `activity_events_org_created_idx`;--> statement-breakpoint
DROP INDEX `activity_events_user_created_idx`;--> statement-breakpoint
DROP INDEX `activity_events_action_created_idx`;--> statement-breakpoint
DROP INDEX `activity_events_target_created_idx`;--> statement-breakpoint
DROP INDEX `activity_events_created_idx`;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `category` text DEFAULT 'audit' NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_events_org_created_idx` ON `audit_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_user_created_idx` ON `audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_action_created_idx` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_created_idx` ON `audit_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_category_created_idx` ON `audit_events` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);