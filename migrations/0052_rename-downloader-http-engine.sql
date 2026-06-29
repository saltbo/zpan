PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_downloaders` (
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
	`engine` text DEFAULT 'http' NOT NULL,
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
INSERT INTO `__new_downloaders`("id", "name", "token_hash", "token_jti", "status", "enabled", "version", "hostname", "platform", "arch", "engine", "capabilities", "max_concurrent_tasks", "current_tasks", "download_bps", "upload_bps", "free_disk_bytes", "remote_download_credit_billing_enabled", "remote_download_credit_unit_bytes", "remote_download_credit_per_unit", "last_heartbeat_at", "created_by", "created_at", "updated_at") SELECT "id", "name", "token_hash", "token_jti", "status", "enabled", "version", "hostname", "platform", "arch", "engine", "capabilities", "max_concurrent_tasks", "current_tasks", "download_bps", "upload_bps", "free_disk_bytes", "remote_download_credit_billing_enabled", "remote_download_credit_unit_bytes", "remote_download_credit_per_unit", "last_heartbeat_at", "created_by", "created_at", "updated_at" FROM `downloaders`;--> statement-breakpoint
DROP TABLE `downloaders`;--> statement-breakpoint
ALTER TABLE `__new_downloaders` RENAME TO `downloaders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `downloaders_token_jti_unique` ON `downloaders` (`token_jti`);--> statement-breakpoint
CREATE INDEX `downloaders_status_idx` ON `downloaders` (`status`);--> statement-breakpoint
CREATE INDEX `downloaders_enabled_idx` ON `downloaders` (`enabled`);--> statement-breakpoint
CREATE INDEX `downloaders_created_idx` ON `downloaders` (`created_at`);