CREATE TABLE `oauthClientRegistration` (
	`client_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauthClient`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClientRegistration_token_hash_unique` ON `oauthClientRegistration` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauthClientRegistration_token_hash_idx` ON `oauthClientRegistration` (`token_hash`);