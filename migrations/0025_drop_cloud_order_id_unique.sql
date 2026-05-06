DROP INDEX `quota_delivery_events_order_uniq`;--> statement-breakpoint
CREATE INDEX `quota_delivery_events_order_idx` ON `quota_delivery_events` (`cloud_order_id`);