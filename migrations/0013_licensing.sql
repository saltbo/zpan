CREATE TABLE `license_binding` (
	`id` integer PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`cloud_account_id` text,
	`cloud_account_email` text,
	`refresh_token` text NOT NULL,
	`cached_cert` text,
	`cached_expires_at` integer,
	`last_refresh_at` integer,
	`last_refresh_error` text,
	`bound_at` integer
);
