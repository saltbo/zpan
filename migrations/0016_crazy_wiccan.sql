CREATE TABLE `license_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`cloud_binding_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`cloud_account_id` text NOT NULL,
	`cloud_account_email` text,
	`status` text NOT NULL,
	`refresh_token` text,
	`cached_certificate` text,
	`cached_certificate_expires_at` integer,
	`bound_at` integer NOT NULL,
	`disconnected_at` integer,
	`last_refresh_at` integer,
	`last_refresh_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `license_bindings_active_uniq` ON `license_bindings` (`status`) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX `license_bindings_cloud_binding_idx` ON `license_bindings` (`cloud_binding_id`);--> statement-breakpoint
CREATE INDEX `license_bindings_instance_idx` ON `license_bindings` (`instance_id`);