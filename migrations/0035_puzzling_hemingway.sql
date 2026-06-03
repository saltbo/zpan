CREATE TABLE `download_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_uri` text NOT NULL,
	`name` text,
	`target_folder` text DEFAULT '' NOT NULL,
	`assigned_downloader_id` text,
	`status` text NOT NULL,
	`downloaded_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`authorized_bytes` integer DEFAULT 0 NOT NULL,
	`billed_bytes` integer DEFAULT 0 NOT NULL,
	`billed_credits` integer DEFAULT 0 NOT NULL,
	`billing_status` text DEFAULT 'none' NOT NULL,
	`download_bps` integer DEFAULT 0 NOT NULL,
	`upload_bps` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`result_object_id` text,
	`upload_token_hash` text,
	`upload_token_jti` text,
	`upload_token_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`assigned_at` integer,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `download_tasks_org_created_idx` ON `download_tasks` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `download_tasks_org_status_idx` ON `download_tasks` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `download_tasks_downloader_idx` ON `download_tasks` (`assigned_downloader_id`,`status`);--> statement-breakpoint
CREATE TABLE `downloaders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_jti` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` text DEFAULT 'unknown' NOT NULL,
	`hostname` text DEFAULT 'unknown' NOT NULL,
	`platform` text DEFAULT 'unknown' NOT NULL,
	`arch` text DEFAULT 'unknown' NOT NULL,
	`engine` text DEFAULT 'builtin' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`max_concurrent_tasks` integer DEFAULT 1 NOT NULL,
	`current_tasks` integer DEFAULT 0 NOT NULL,
	`download_bps` integer DEFAULT 0 NOT NULL,
	`upload_bps` integer DEFAULT 0 NOT NULL,
	`free_disk_bytes` integer DEFAULT 0 NOT NULL,
	`remote_download_credit_billing_enabled` integer DEFAULT false NOT NULL,
	`remote_download_credit_unit_bytes` integer DEFAULT 104857600 NOT NULL,
	`remote_download_credit_per_unit` integer DEFAULT 1 NOT NULL,
	`last_heartbeat_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloaders_token_jti_unique` ON `downloaders` (`token_jti`);--> statement-breakpoint
CREATE INDEX `downloaders_status_idx` ON `downloaders` (`status`);--> statement-breakpoint
CREATE INDEX `downloaders_enabled_idx` ON `downloaders` (`enabled`);--> statement-breakpoint
CREATE INDEX `downloaders_created_idx` ON `downloaders` (`created_at`);--> statement-breakpoint
CREATE TABLE `object_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`object_id` text NOT NULL,
	`storage_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`part_size` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `object_upload_sessions_object_idx` ON `object_upload_sessions` (`org_id`,`object_id`);--> statement-breakpoint
CREATE INDEX `object_upload_sessions_expires_idx` ON `object_upload_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `remote_download_usage_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`downloader_id` text NOT NULL,
	`task_id` text NOT NULL,
	`event_id` text NOT NULL,
	`unit_index` integer NOT NULL,
	`unit_bytes` integer NOT NULL,
	`credits_per_unit` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_download_usage_reports_event_id_unique` ON `remote_download_usage_reports` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `remote_download_usage_task_unit_uniq` ON `remote_download_usage_reports` (`task_id`,`unit_index`);--> statement-breakpoint
CREATE INDEX `remote_download_usage_org_idx` ON `remote_download_usage_reports` (`org_id`);--> statement-breakpoint
CREATE INDEX `remote_download_usage_status_idx` ON `remote_download_usage_reports` (`status`);--> statement-breakpoint
CREATE TABLE `deviceCode` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`client_id` text,
	`scope` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deviceCode_device_code_idx` ON `deviceCode` (`device_code`);--> statement-breakpoint
CREATE INDEX `deviceCode_user_code_idx` ON `deviceCode` (`user_code`);--> statement-breakpoint
CREATE INDEX `deviceCode_status_idx` ON `deviceCode` (`status`);