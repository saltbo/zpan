CREATE TABLE `image_hosting_configs` (
	`org_id` text PRIMARY KEY NOT NULL,
	`custom_domain` text,
	`cf_hostname_id` text,
	`domain_verified_at` integer,
	`referer_allowlist` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_hosting_configs_custom_domain_unique` ON `image_hosting_configs` (`custom_domain`);--> statement-breakpoint
CREATE TABLE `image_hostings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`token` text NOT NULL,
	`path` text NOT NULL,
	`storage_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_hostings_token_unique` ON `image_hostings` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_hostings_org_path_uniq` ON `image_hostings` (`org_id`,`path`);--> statement-breakpoint
CREATE INDEX `image_hostings_org_created_idx` ON `image_hostings` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `image_hostings_token_idx` ON `image_hostings` (`token`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`rate_limit_enabled` integer DEFAULT true NOT NULL,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_config_id_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);