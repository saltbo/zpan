CREATE TABLE `oauthPushedAuthorizationRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`request_uri` text NOT NULL,
	`client_id` text NOT NULL,
	`parameters` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthPushedAuthorizationRequest_request_uri_unique` ON `oauthPushedAuthorizationRequest` (`request_uri`);--> statement-breakpoint
CREATE INDEX `oauthPushedAuthorizationRequest_client_id_idx` ON `oauthPushedAuthorizationRequest` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthPushedAuthorizationRequest_expires_at_idx` ON `oauthPushedAuthorizationRequest` (`expires_at`);--> statement-breakpoint
ALTER TABLE `oauthAccessToken` ADD `authorization_details` text;--> statement-breakpoint
ALTER TABLE `oauthConsent` ADD `authorization_details` text;--> statement-breakpoint
ALTER TABLE `oauthRefreshToken` ADD `authorization_details` text;