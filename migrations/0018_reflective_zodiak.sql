CREATE TABLE `quota_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`cloud_order_id` text,
	`cloud_redemption_id` text,
	`payload_hash` text NOT NULL,
	`raw_payload` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_delivery_events_event_uniq` ON `quota_delivery_events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_delivery_events_order_uniq` ON `quota_delivery_events` (`cloud_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_delivery_events_redemption_uniq` ON `quota_delivery_events` (`cloud_redemption_id`);--> statement-breakpoint
CREATE TABLE `quota_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`source` text NOT NULL,
	`external_event_id` text,
	`cloud_order_id` text,
	`cloud_redemption_id` text,
	`code` text,
	`bytes` integer NOT NULL,
	`package_snapshot` text,
	`granted_by` text,
	`terminal_user_id` text,
	`terminal_user_email` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_grants_org_created_idx` ON `quota_grants` (`org_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_grants_external_event_uniq` ON `quota_grants` (`external_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_grants_cloud_order_uniq` ON `quota_grants` (`cloud_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_grants_cloud_redemption_uniq` ON `quota_grants` (`cloud_redemption_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_grants_code_uniq` ON `quota_grants` (`code`);--> statement-breakpoint
CREATE TABLE `quota_store_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`bytes` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`cloud_package_id` text,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_store_packages_active_sort_idx` ON `quota_store_packages` (`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `quota_store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`cloud_base_url` text NOT NULL,
	`public_instance_url` text NOT NULL,
	`webhook_signing_secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
