CREATE TABLE `quota_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`cloud_order_id` text,
	`payload_hash` text,
	`raw_payload` text,
	`status` text DEFAULT 'processed' NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_delivery_events_event_id_unique` ON `quota_delivery_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `quota_delivery_events_cloud_order_idx` ON `quota_delivery_events` (`cloud_order_id`);--> statement-breakpoint
CREATE INDEX `quota_delivery_events_created_idx` ON `quota_delivery_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `quota_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`source` text NOT NULL,
	`external_event_id` text,
	`cloud_order_id` text,
	`code` text,
	`bytes` integer NOT NULL,
	`package_snapshot` text,
	`granted_by` text,
	`terminal_user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_grants_org_created_idx` ON `quota_grants` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quota_grants_external_event_idx` ON `quota_grants` (`external_event_id`);--> statement-breakpoint
CREATE INDEX `quota_grants_cloud_order_idx` ON `quota_grants` (`cloud_order_id`);--> statement-breakpoint
CREATE TABLE `quota_store_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`bytes` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`cloud_sync_id` text,
	`cloud_sync_status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_store_packages_active_sort_idx` ON `quota_store_packages` (`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `quota_store_settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`cloud_base_url` text,
	`instance_public_url` text,
	`webhook_signing_secret` text,
	`updated_at` integer
);
--> statement-breakpoint
ALTER TABLE `announcements` DROP COLUMN `expires_at`;