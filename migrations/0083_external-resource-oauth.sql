CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`alg` text,
	`crv` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauthClientAssertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauthClientResource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `oauthResource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauthClientResource_client_id_idx` ON `oauthClientResource` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resource_id_idx` ON `oauthClientResource` (`resource_id`);--> statement-breakpoint
CREATE TABLE `oauthResource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`policy_version` integer DEFAULT 1,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthResource_identifier_unique` ON `oauthResource` (`identifier`);--> statement-breakpoint
CREATE INDEX `oauthResource_identifier_idx` ON `oauthResource` (`identifier`);--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `authorization_code_id` text;--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `revoked` integer;--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `confirmation` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `backchannel_logout_uri` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `backchannel_logout_session_required` integer;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `jwks` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `jwks_uri` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `dpop_bound_access_tokens` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `oauthConsent` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauthConsent` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `authorization_code_id` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `requested_user_info_claims` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `rotated_at` integer;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `rotation_replay_response` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `rotation_replay_expires_at` integer;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `confirmation` text;