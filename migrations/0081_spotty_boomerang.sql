CREATE TABLE `oauthAccessToken` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `oauthRefreshToken`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthAccessToken_token_unique` ON `oauthAccessToken` (`token`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_client_id_idx` ON `oauthAccessToken` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_session_id_idx` ON `oauthAccessToken` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_user_id_idx` ON `oauthAccessToken` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refresh_id_idx` ON `oauthAccessToken` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_token_idx` ON `oauthAccessToken` (`token`);--> statement-breakpoint
CREATE TABLE `oauthClient` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`token_endpoint_auth_method` text,
	`grant_types` text,
	`response_types` text,
	`public` integer,
	`type` text,
	`require_pkce` integer,
	`reference_id` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClient_client_id_unique` ON `oauthClient` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClient_client_id_idx` ON `oauthClient` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClient_user_id_idx` ON `oauthClient` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauthConsent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`scopes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauthConsent_client_id_idx` ON `oauthConsent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_user_id_idx` ON `oauthConsent` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauthRefreshToken` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked` integer,
	`auth_time` integer,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthRefreshToken_token_unique` ON `oauthRefreshToken` (`token`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_client_id_idx` ON `oauthRefreshToken` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_session_id_idx` ON `oauthRefreshToken` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_user_id_idx` ON `oauthRefreshToken` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_token_idx` ON `oauthRefreshToken` (`token`);