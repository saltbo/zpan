ALTER TABLE `quota_delivery_events` RENAME TO `webhook_events`;--> statement-breakpoint
DROP TABLE `quota_grants`;--> statement-breakpoint
DROP INDEX `quota_delivery_events_event_uniq`;--> statement-breakpoint
DROP INDEX `quota_delivery_events_order_idx`;--> statement-breakpoint
DROP INDEX `quota_delivery_events_redemption_uniq`;--> statement-breakpoint
DROP INDEX `quota_delivery_events_code_uniq`;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `source` text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `event_type` text DEFAULT 'order.quota_changed' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_source_event_uniq` ON `webhook_events` (`source`,`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_source_created_idx` ON `webhook_events` (`source`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_status_idx` ON `webhook_events` (`status`);--> statement-breakpoint
ALTER TABLE `webhook_events` DROP COLUMN `cloud_order_id`;--> statement-breakpoint
ALTER TABLE `webhook_events` DROP COLUMN `cloud_redemption_id`;--> statement-breakpoint
ALTER TABLE `webhook_events` DROP COLUMN `code`;