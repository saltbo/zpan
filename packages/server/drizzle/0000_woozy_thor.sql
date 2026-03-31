CREATE TABLE `matters` (
	`id` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`alias` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer DEFAULT 0,
	`dirtype` integer DEFAULT 0,
	`parent` text DEFAULT '' NOT NULL,
	`object` text DEFAULT '' NOT NULL,
	`storage_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matters_alias_unique` ON `matters` (`alias`);--> statement-breakpoint
CREATE TABLE `storage_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`quota` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_quotas_uid_unique` ON `storage_quotas` (`uid`);--> statement-breakpoint
CREATE TABLE `storages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`bucket` text NOT NULL,
	`endpoint` text NOT NULL,
	`region` text DEFAULT 'auto' NOT NULL,
	`access_key` text NOT NULL,
	`secret_key` text NOT NULL,
	`file_path` text DEFAULT '$UID/$RAW_NAME' NOT NULL,
	`custom_host` text DEFAULT '',
	`capacity_bytes` integer,
	`used_bytes` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_options` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`public` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);