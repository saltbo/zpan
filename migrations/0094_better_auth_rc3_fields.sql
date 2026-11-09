ALTER TABLE `deviceCode` ADD `resource` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `client_discovery_id` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `client_credentials_scopes` text;--> statement-breakpoint
ALTER TABLE `oauthClient` ADD `application_type` text;